package dev.susyplanner.heioracle;

import dev.susyplanner.heioracle.icons.IconQueue;
import mezz.jei.api.IModPlugin;
import mezz.jei.api.IModRegistry;
import mezz.jei.api.JEIPlugin;

/**
 * Hooks HEI (Had Enough Items) to capture its ingredient registry so the oracle
 * can render exactly the item/fluid list the recipe viewer shows in-game.
 */
@JEIPlugin
public class SusyHeiOracleHeiPlugin implements IModPlugin {

    @Override
    public void register(IModRegistry registry) {
        IconQueue.init(registry.getIngredientRegistry());
    }
}