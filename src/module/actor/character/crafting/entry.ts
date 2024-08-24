import type { CharacterPF2e } from "@actor";
import type { ItemPF2e } from "@item";
import { CraftingEntryRuleData, CraftingEntryRuleSource } from "@module/rules/rule-element/crafting/entry.ts";
import { Predicate, RawPredicate } from "@system/predication.ts";
import { ErrorPF2e } from "@util";
import { UUIDUtils } from "@util/uuid.ts";
import { CraftingFormula } from "./formula.ts";

class CraftingEntry implements CraftingEntryData {
    /** A label for this crafting entry to display on sheets */
    name: string;

    selector: string;

    /** This crafting entry's parent item */
    parent: ItemPF2e<CharacterPF2e>;

    /** All formulas relevant to this crafting known by the grandparent actor */
    knownFormulas: CraftingFormula[];

    preparedCraftingFormulas: PreparedCraftingFormula[];
    preparedFormulaData: PreparedFormulaData[];
    isAlchemical: boolean;
    isDailyPrep: boolean;
    isPrepared: boolean;
    craftableItems: Predicate;
    maxSlots: number;
    fieldDiscovery: Predicate | null;
    batchSizes: { default: number; other: { definition: Predicate; quantity: number }[] };
    fieldDiscoveryBatchSize: number;
    maxItemLevel: number;

    constructor(knownFormulas: CraftingFormula[], data: CraftingEntryData) {
        this.parent = data.item;
        this.selector = data.selector;
        this.name = data.name;
        this.isAlchemical = data.isAlchemical;
        this.isDailyPrep = data.isDailyPrep;
        this.isPrepared = data.isPrepared;
        this.maxSlots = data.maxSlots ?? 0;
        this.maxItemLevel = data.maxItemLevel ?? this.actor.level;
        this.fieldDiscovery = data.fieldDiscovery ? new Predicate(data.fieldDiscovery) : null;
        this.batchSizes = {
            default: data.batchSize ?? (this.isAlchemical ? 1 : 1),
            other:
                data.batchSizes?.other.map((o) => ({
                    definition: new Predicate(o.definition),
                    quantity: o.quantity,
                })) ?? [],
        };
        this.fieldDiscoveryBatchSize = data.fieldDiscoveryBatchSize ?? 3;
        this.craftableItems = new Predicate(data.craftableItems);
        this.knownFormulas = knownFormulas.filter((f) => this.craftableItems.test(f.options));
        this.preparedFormulaData = (data.preparedFormulaData ?? []).filter((d) =>
            this.knownFormulas.some((f) => f.item.uuid === d.itemUUID),
        );
        this.preparedCraftingFormulas = this.preparedFormulaData
            .sort((prepDataA, prepDataB) => (prepDataA.sort ?? 0) - (prepDataB.sort ?? 0))
            .flatMap((prepData): PreparedCraftingFormula | never[] => {
                const formula = this.knownFormulas.find((f) => f.uuid === prepData.itemUUID);
                return formula
                    ? Object.assign(new CraftingFormula(formula.item), {
                          quantity: prepData.quantity || 1,
                          expended: !!prepData.expended,
                          isSignatureItem: !!prepData.isSignatureItem,
                          sort: prepData.sort ?? 0,
                      })
                    : [];
            });
    }

    get item(): ItemPF2e<CharacterPF2e> {
        return this.parent;
    }

    get actor(): CharacterPF2e {
        return this.parent.actor;
    }

    get formulas(): (PreparedFormulaSheetData | null)[] {
        const formulas: (PreparedFormulaSheetData | null)[] = this.preparedCraftingFormulas.map((formula) => {
            return {
                uuid: formula.uuid,
                img: formula.img,
                name: formula.name,
                expended: formula.expended,
                quantity: formula.quantity,
                isSignatureItem: formula.isSignatureItem,
            };
        });
        if (this.maxSlots > 0) {
            const fill = this.maxSlots - formulas.length;
            if (fill > 0) {
                const nulls = new Array(fill).fill(null);
                return formulas.concat(nulls);
            }
        }
        return formulas;
    }

    get reagentCost(): number {
        if (!this.isAlchemical) return 0;

        return Math.ceil(
            this.preparedCraftingFormulas.reduce((total, formula) => {
                return total + formula.quantity / this.#batchSizeFor(formula);
            }, 0),
        );
    }

    static isValid(data: Maybe<Partial<CraftingEntryData>>): data is CraftingEntryData {
        return !!data && !!data.name && !!data.selector;
    }

    async prepareFormula(formula: CraftingFormula): Promise<void> {
        this.checkEntryRequirements(formula);

        const quantity = this.#batchSizeFor(formula);
        const existing = this.preparedFormulaData.find((f) => f.itemUUID === formula.uuid);
        if (existing && this.isAlchemical) {
            existing.quantity = quantity;
        } else {
            this.preparedFormulaData.push({ itemUUID: formula.uuid, quantity });
        }

        return this.#updateRuleElement();
    }

    checkEntryRequirements(formula: CraftingFormula, { warn = true } = {}): boolean {
        if (!!this.maxSlots && this.formulas.filter((f) => f !== null).length >= this.maxSlots) {
            if (warn) ui.notifications.warn(game.i18n.localize("PF2E.CraftingTab.Alerts.MaxSlots"));
            return false;
        }

        if (formula.level > this.maxItemLevel) {
            if (warn) {
                ui.notifications.warn(
                    game.i18n.format("PF2E.CraftingTab.Alerts.MaxItemLevel", { level: this.maxItemLevel }),
                );
            }
            return false;
        }

        if (!this.craftableItems.test(formula.item.getRollOptions("item"))) {
            if (warn) {
                ui.notifications.warn(game.i18n.localize("PF2E.CraftingTab.Alerts.ItemMissingTraits"));
            }
            return false;
        }

        return true;
    }

    async unprepareFormula(index: number, itemUUID: string): Promise<void> {
        const formula = this.preparedFormulaData[index];
        if (!formula || formula.itemUUID !== itemUUID) return;

        this.preparedFormulaData.splice(index, 1);

        return this.#updateRuleElement();
    }

    async setFormulaQuantity(index: number, itemUUID: string, value: "increase" | "decrease" | number): Promise<void> {
        if (!UUIDUtils.isItemUUID(itemUUID)) {
            throw ErrorPF2e(`invalid item UUID: ${itemUUID}`);
        }
        const data = this.preparedFormulaData[index];
        if (data?.itemUUID !== itemUUID) return;
        const item = this.fieldDiscovery ? await fromUuid<ItemPF2e>(itemUUID) : null;
        const currentQuantity = data.quantity ?? 0;
        const adjustment = this.fieldDiscovery?.test(item?.getRollOptions("item") ?? []) ? 1 : this.#batchSizeFor(data);
        const newQuantity =
            typeof value === "number"
                ? value
                : value === "increase"
                  ? currentQuantity + adjustment
                  : currentQuantity - adjustment;
        data.quantity = Math.ceil(Math.clamp(newQuantity, adjustment, adjustment * 50) / adjustment) * adjustment;

        return this.#updateRuleElement();
    }

    async toggleFormulaExpended(index: number, itemUUID: string): Promise<void> {
        const data = this.preparedFormulaData[index];
        if (data?.itemUUID !== itemUUID) return;
        data.expended = !data.expended;

        return this.#updateRuleElement();
    }

    async toggleSignatureItem(itemUUID: string): Promise<void> {
        const data = this.preparedFormulaData.find((f) => f.itemUUID === itemUUID);
        if (data?.itemUUID !== itemUUID) return;
        data.isSignatureItem = !data.isSignatureItem;

        return this.setFormulaQuantity(
            this.preparedFormulaData.indexOf(data),
            itemUUID,
            data.quantity ?? this.#batchSizeFor(data),
        );
    }

    async updateFormulas(formulas: PreparedFormulaData[]): Promise<void> {
        this.preparedFormulaData = formulas;
        return this.#updateRuleElement();
    }

    #batchSizeFor(data: CraftingFormula | PreparedFormulaData): number {
        const formula =
            data instanceof CraftingFormula ? data : this.knownFormulas.find((f) => f.item.uuid === data.itemUUID);
        if (!formula) return 1;

        const isSignatureItem = "isSignatureItem" in data && !!data.isSignatureItem;
        if (isSignatureItem || this.fieldDiscovery?.test(formula.options)) {
            return this.fieldDiscoveryBatchSize;
        }

        const specialBatchSize = this.batchSizes.other.find((s) => s.definition.test(formula.options));
        return specialBatchSize?.quantity ?? this.batchSizes.default;
    }

    async #updateRuleElement(): Promise<void> {
        const rules = this.item.toObject().system.rules;
        const ruleSource = rules.find(
            (r: CraftingEntryRuleSource): r is CraftingEntryRuleData =>
                r.key === "CraftingEntry" && r.selector === this.selector,
        );
        if (ruleSource) {
            ruleSource.preparedFormulas = this.preparedFormulaData;
            await this.parent.update({ "system.rules": rules });
        }
    }
}

interface CraftingEntryData {
    selector: string;
    name: string;
    item: ItemPF2e<CharacterPF2e>;
    isAlchemical: boolean;
    isDailyPrep: boolean;
    isPrepared: boolean;
    maxSlots?: number;
    craftableItems: RawPredicate;
    fieldDiscovery?: RawPredicate | null;
    batchSize?: number;
    batchSizes?: { default: number; other: { definition: RawPredicate; quantity: number }[] };
    fieldDiscoveryBatchSize?: number;
    maxItemLevel?: number | null;
    preparedFormulaData?: PreparedFormulaData[];
}

interface PreparedFormulaData {
    itemUUID: string;
    quantity?: number;
    expended?: boolean;
    isSignatureItem?: boolean;
    sort?: number;
}

interface PreparedCraftingFormula extends CraftingFormula {
    quantity: number;
    expended: boolean;
    isSignatureItem: boolean;
    sort: number;
}

interface PreparedFormulaSheetData {
    uuid: string;
    expended: boolean;
    img: ImageFilePath;
    name: string;
    quantity: number;
    isSignatureItem: boolean;
}

export { CraftingEntry };
export type { CraftingEntryData, PreparedFormulaData };
