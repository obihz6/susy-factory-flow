# Hatch power readout coverage audit

This document is a sweep of the existing planner model, not verification of every machine against game code. The [Industrial Farm source audit](industrial-farm-power-audit.md) records the game mechanics and the decision to retain requirement-driven farm planning.

The readout uses the same power report, overclock stats, structural parallel limit, and cached power ladder as the solver. Sections describe the current setup: no reachable parallel count above one means no parallels section; no reachable overclock means no overclock section; no next power step means no improvement section.

## Mode accounting

- Build: running draw multiplied by utilization gives average draw per machine. Shared cards use the weighted recipe mix.
- Solve / Pool: sum the scaled solver EU/t for the card's active recipe sections. Do not multiply nameplate draw by the normalized utilization (which is one for active solved sections). Inactive sections retain nameplate EU/t for ports and must contribute zero.
- Browser check: a 30,720 EU/t LCR scaled to 2.88 machines reports 88,473.6 EU/t in both Solve and Pool.

## Specialized machines

| Family | Treatment |
| --- | --- |
| Industrial Farm | Original seed-bed selector, upgrades and target overclocks; required consumption stays in the existing Power section. No added supply controls or duplicate badge. |
| Crop Manager | Original manager tier and Power section; no added requirement badge, artificial recipe overclocks or parallels. |
| Industrial / Mega Apiary, Tree Growth Simulator | Retain their existing specialized controls. They are not covered by the curated hatch calculation; do not invent supply-to-output improvements. |
| Fusion and other runtime-only machines | Retain the existing voltage/runtime controls. The new editable hatch controls remain restricted to curated multiblocks. |
| Steam / zero-EU / manual work | No electric hatch control. Steam continues using its steam report. |
| Transcendent Plasma Mixer | Parallel configuration remains meaningful; no overclock readout. |
| Source / Target Chambers | No overclock or parallel ladder in the curated model. Beam energy remains unmodelled. |
| Neutron Activator | Curated power multiplier is zero; no meaningful electric improvement ladder. |
| Naquadah Fuel Refinery | Overclocks depend on recipe special value and field-restriction coil configuration; an unavailable step in one setup does not imply the machine can never overclock. |

The farm browser fixture uses 900 seeds in 729-seat IV farms: two farms, 7,680 EU/t each, 15,360 EU/t total while operating. An unused farm slot does not reduce its running draw. Build averages follow the planner's utilization; Solve/Pool use their calculated seed count and whole-farm requirement.

## Curated model sweep

All 90 curated definitions were evaluated with a synthetic 30 EU/t, 400-tick LV recipe, IV input at 4 A, and default configuration. Every draw was finite. The ladder scan covers the supported power-budget range. These results describe that fixture, not every recipe/configuration combination; recipe gates and configuration-dependent capabilities still come from the live solver.

| Machine | Parallels above 1 in probe | Overclock step in probe |
| --- | --- | --- |
| Blast Furnace | No | Yes |
| Mega Blast Furnace | Yes | Yes |
| Volcanus | Yes | Yes |
| Exothermic Hearth | Yes | Yes |
| Large Chemical Reactor | No | Yes |
| Mega Chemical Reactor | Yes | Yes |
| Circuit Assembly Line | No | Yes |
| Digester | No | Yes |
| Elemental Duplicator | Yes | Yes |
| IsaMill Grinding Machine | No | Yes |
| Flotation Cell Regulator | No | Yes |
| Chemical Plant | Yes | Yes |
| Pyrolyse Oven | No | Yes |
| Oil Cracker | No | Yes |
| Mega Oil Cracker | Yes | Yes |
| Zyngen | Yes | Yes |
| Multi Smelter | Yes | Yes |
| Mega Alloy Blast Smelter | Yes | Yes |
| Large Fluid Extractor | Yes | Yes |
| Large Thermal Refinery | Yes | Yes |
| Alloy Blast Smelter | No | Yes |
| Big Barrel Brewery | Yes | Yes |
| Boldarnator | Yes | Yes |
| Bricked Blast Furnace | No | Yes |
| COMET - Compact Cyclotron | No | Yes |
| Cryogenic Freezer | Yes | Yes |
| Density^2 | Yes | Yes |
| Dissolution Tank | No | Yes |
| Distillation Tower | No | Yes |
| Implosion Compressor | No | Yes |
| Industrial Centrifuge | Yes | Yes |
| Industrial Extrusion Machine | Yes | Yes |
| Large Scale Auto-Assembler v1.01 | Yes | Yes |
| Mega Distillation Tower | Yes | Yes |
| Molecular Transformer | No | Yes |
| Nuclear Salt Processing Plant | Yes | Yes |
| Ore Washing Plant | No | Yes |
| Source Chamber | No | No |
| Target Chamber | No | No |
| Thermic Heating Device | Yes | Yes |
| TurboCan Pro | Yes | Yes |
| Vacuum Freezer | No | Yes |
| Zhuhai - Fishing Port | Yes | Yes |
| Industrial Arc Furnace | Yes | Yes |
| Industrial Cutting Factory | Yes | Yes |
| Magnetic Flux Exhibitor | Yes | Yes |
| Industrial Autoclave | Yes | Yes |
| Electric Implosion Compressor | No | Yes |
| Dissection Apparatus | Yes | Yes |
| Industrial Sledgehammer | Yes | Yes |
| Industrial Precision Lathe | Yes | Yes |
| Industrial Maceration Stack | Yes | Yes |
| Industrial Mixing Machine | Yes | Yes |
| Multiblock Dehydrator | Yes | Yes |
| Industrial Wire Factory | Yes | Yes |
| Amazon Warehousing Depot | Yes | Yes |
| Hyper-Intensity Laser Engraver | No | Yes |
| Transcendent Plasma Mixer | No | No |
| Neutron Activator | No | No |
| Naquadah Fuel Refinery | Yes | No |
| Endothermic Fridge | Yes | Yes |
| Large Electric Compressor | Yes | Yes |
| Hot Isostatic Pressurization Unit | Yes | Yes |
| Neutronium Compressor | Yes | Yes |
| Bacterial Vat | No | Yes |
| Research Station | No | Yes |
| Multiblock Electrolyzer | Yes | Yes |
| Large Sifter | Yes | Yes |
| Industrial Forming Press | Yes | Yes |
| Industrial Coke Oven | No | Yes |
| Matter Fabricator | Yes | Yes |
| Pseudostable Black Hole Containment Field | Yes | Yes |
| Arc Furnace | No | Yes |
| Short Circuit Heater | No | Yes |
| Auto Workbench | No | Yes |
| Steam Grinder | Yes | No |
| Steam Squasher | Yes | No |
| Steam Separator | Yes | No |
| Steam Purifier | Yes | No |
| Steam Presser | Yes | No |
| Steam Blender | Yes | No |
| Steam Fuser | Yes | No |
| Steam Hearth | Yes | No |
| Spinmatron-2737 | Yes | Yes |
| Industrial Chemical Bath | Yes | Yes |
| Industrial Bending Machine | Yes | Yes |
| Industrial 3D Copying Machine | Yes | Yes |
| Mass Solidifier | Yes | Yes |
| Fluid Shaper | Yes | Yes |
| L.A.T.E.X. | Yes | Yes |
