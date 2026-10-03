# GURPS Supers VTT — V1 Playable Core

## Objective

Ship the fastest version that can run a complete session both remotely and at a physical table.

The V1 is a rules-and-state tool first. Visual spectacle is explicitly secondary.

## Product priorities

1. Combat
2. Character sheets
3. Inventory
4. Libraries / databases
5. Multiplayer campaign state
6. Custom archetypes, powers and NP progression

## V1 core modules

### Character Sheet
- GURPS attributes and secondary characteristics
- HP / FP
- skills
- advantages / disadvantages
- attacks and defenses
- equipment and encumbrance
- archetype, foundation, power and NP

### Combat
- participants and initiative
- maneuver selection
- attack roll and effective skill
- active defense
- hit location
- damage roll
- DR
- wounding/injury
- HP / FP updates
- shock and relevant injury/condition checks
- persistent combat state

The combat engine should remain usable independently from the presentation layer so it can later power both live combat and automated simulations.

### Inventory
- character inventory
- equipped state
- quantity
- weight
- consumables
- weapons / armor integration

### Library
Searchable reusable records for:
- weapons
- armor
- equipment
- substances
- advantages / disadvantages
- skills
- powers
- conditions

Game content should be data-driven wherever practical rather than hard-coded into UI components.

### Multiplayer
- campaign/session
- GM and player roles
- shared authoritative state
- remote play through browser
- the same game state must also work for players sitting at the same physical table

## Explicitly deferred

These features may remain in the codebase but are not V1 priorities:

- 3D presentation
- sophisticated maps
- lighting / fog of war
- travel simulation
- fishing / foraging / gathering
- cooking
- alchemy
- crafting
- elaborate downtime systems
- visual polish that does not improve play speed

Do not delete stable deferred systems merely to reduce the repository. Prefer removing them from the primary V1 navigation first.

## Design principle

> Automate bookkeeping, not player decisions.

Players choose actions, targets, maneuvers, defenses, powers and risks.

The application calculates and persists the mechanical consequences.

## First implementation milestone

A group can open the app, create/select characters, start combat, resolve attacks/defenses/damage, update character state, manage equipment, and continue the same campaign from multiple devices.

No map is required for this milestone.
