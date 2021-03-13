import { LocalizePF2e } from '@system/localize';
import { registerSheets } from '../register-sheets';

function registerPF2ActionClickListener() {
    document.body.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | undefined;
        const { pf2Action, pf2Glyph, pf2Variant } = target?.dataset ?? {};
        if (pf2Action && target?.matches('[data-pf2-action]:not([data-pf2-action=""])')) {
            const action = game.pf2e.actions[pf2Action];
            if (action) {
                action({
                    event,
                    glyph: pf2Glyph,
                    variant: pf2Variant,
                });
            }
        }
    });
}

/**
 * This runs after game data has been requested and loaded from the servers, so entities exist
 */
export function listen() {
    Hooks.once('setup', () => {
        LocalizePF2e.ready = true;

        // Register actor and item sheets
        registerSheets();

        // register click listener for elements with a data-pf2-action attribute
        registerPF2ActionClickListener();

        // Localize CONFIG objects once up-front
        const toLocalize = [
            'abilities',
            'skills',
            'martialSkills',
            'currencies',
            'saves',
            'armorTraits',
            'preciousMaterialGrades',
            'armorPotencyRunes',
            'armorResiliencyRunes',
            'armorPropertyRunes',
            'weaponPotencyRunes',
            'weaponStrikingRunes',
            'weaponPropertyRunes',
            'rarityTraits',
            'damageTypes',
            'weaponDamage',
            'healingTypes',
            'weaponTypes',
            'weaponGroups',
            'consumableTraits',
            'weaponDescriptions',
            'weaponTraits',
            'traitsDescriptions',
            'weaponHands',
            'equipmentTraits',
            'itemBonuses',
            'damageDie',
            'weaponRange',
            'weaponMAP',
            'weaponReload',
            'armorTypes',
            'armorGroups',
            'consumableTypes',
            'magicTraditions',
            'preparationType',
            'spellTraits',
            'featTraits',
            'areaTypes',
            'areaSizes',
            'classTraits',
            'ancestryTraits',
            'alignment',
            'skillList',
            'spellComponents',
            'spellTypes',
            'spellTraditions',
            'spellSchools',
            'spellLevels',
            'featTypes',
            'featActionTypes',
            'actionTypes',
            'actionTypes',
            'actionsNumber',
            'actionCategories',
            'proficiencyLevels',
            'heroPointLevels',
            'actorSizes',
            'bulkTypes',
            'conditionTypes',
            'immunityTypes',
            'resistanceTypes',
            'weaknessTypes',
            'languages',
            'monsterTraits',
            'spellScalingModes',
            'attackEffects',
            'hazardTraits',
            'attributes',
            'speedTypes',
            'senses',
            'preciousMaterials',
            'prerequisitePlaceholders',
            'ancestryItemTraits',
            'levels',
            'dcAdjustments',
        ];
        for (const o of toLocalize) {
            CONFIG.PF2E[o] = Object.entries(CONFIG.PF2E[o]).reduce((obj, e: any) => {
                obj[e[0]] = game.i18n.localize(e[1]);
                return obj;
            }, {});
        }
    });
}
