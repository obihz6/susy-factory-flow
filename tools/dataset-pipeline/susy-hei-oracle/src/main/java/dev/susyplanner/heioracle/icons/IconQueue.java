package dev.susyplanner.heioracle.icons;

import dev.susyplanner.heioracle.SusyHeiOracleMod;
import mezz.jei.api.ingredients.IIngredientRegistry;
import mezz.jei.api.ingredients.VanillaTypes;
import net.minecraft.item.ItemStack;
import net.minecraftforge.fluids.FluidStack;

import java.util.ArrayList;
import java.util.List;

/**
 * Static holder for the HEI ingredient registry and the flat list of every
 * item/fluid the recipe viewer knows about. Filled by the {@code @JEIPlugin}
 * during mod load; consumed by the icon exporter on the client thread.
 */
public final class IconQueue {

    private static IIngredientRegistry ingredientRegistry;
    private static final List<ItemStack> ITEMS = new ArrayList<ItemStack>();
    private static final List<FluidStack> FLUIDS = new ArrayList<FluidStack>();

    private IconQueue() {}

    public static void init(IIngredientRegistry registry) {
        if (ingredientRegistry == null && registry != null) {
            ingredientRegistry = registry;
            ITEMS.addAll(registry.getAllIngredients(VanillaTypes.ITEM));
            FLUIDS.addAll(registry.getAllIngredients(VanillaTypes.FLUID));
            SusyHeiOracleMod.LOG.info(
                "SUSY HEI oracle captured ingredient registry: {} items, {} fluids.",
                Integer.valueOf(ITEMS.size()),
                Integer.valueOf(FLUIDS.size())
            );
        }
    }

    public static boolean isReady() {
        return ingredientRegistry != null;
    }

    public static List<ItemStack> items() {
        return ITEMS;
    }

    public static List<FluidStack> fluids() {
        return FLUIDS;
    }
}