package dev.susyplanner.heioracle.icons;

import dev.susyplanner.heioracle.SusyHeiOracleMod;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GlStateManager;
import net.minecraft.client.renderer.Tessellator;
import net.minecraft.item.ItemStack;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.fluids.FluidStack;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Drives the batch icon export. Items and fluids queued by the HEI plugin (and
 * lazily by the lookup path) are rendered on the client thread inside a GUI
 * draw loop, written as PNGs, and finally mapped to icon-map.json /
 * fluid-icon-map.json. Mirrors the GTNH oracle QueuedIconExportScreen flow.
 */
public final class IconExporter {

    private static final int ICON_EXPORT_BATCH_SIZE = Integer.getInteger("susy.oracle.iconExportBatchSize", 64);
    private static final int ICON_PROGRESS_EVERY = Integer.getInteger("susy.oracle.iconProgressEvery", 256);
    private static final int MAX_RENDER_ATTEMPTS = Integer.getInteger("susy.oracle.maxRenderAttempts", 3);

    private static final Deque<ItemStack> ITEM_QUEUE = new ArrayDeque<ItemStack>();
    private static final Deque<FluidStack> FLUID_QUEUE = new ArrayDeque<FluidStack>();
    private static final Set<String> RENDERED_KEYS = new HashSet<String>();
    private static final List<ItemStack> FAILED_ITEMS = new ArrayList<ItemStack>();
    private static final List<FluidStack> FAILED_FLUIDS = new ArrayList<FluidStack>();
    private static final Map<String, Integer> FAILED_ATTEMPTS = new HashMap<String, Integer>();
    private static final Set<String> EXCLUDED_ITEM_NAMES = buildExcludedItemNames();

    private static int renderedCount;
    private static int failedCount;
    private static int totalCount;
    private static boolean running;
    private static Runnable afterExport;

    private IconExporter() {}

    private static Set<String> buildExcludedItemNames() {
        String property = System.getProperty(
            "susy.oracle.excludeItems",
            "minecraft:enchanting_table,minecraft:end_portal_frame"
        );
        Set<String> names = new HashSet<String>();
        for (String name : property.split(",")) {
            String trimmed = name.trim();
            if (trimmed.length() > 0) {
                names.add(trimmed);
            }
        }
        return names;
    }

    private static boolean isExcludedItem(ItemStack stack) {
        ResourceLocation registryName = stack.getItem().getRegistryName();
        return registryName != null && EXCLUDED_ITEM_NAMES.contains(registryName.toString());
    }

    public static void queueItem(ItemStack stack) {
        if (isExcludedItem(stack)) {
            return;
        }
        ITEM_QUEUE.add(stack);
    }

    public static void queueFluid(FluidStack stack) {
        FLUID_QUEUE.add(stack);
    }

    public static boolean isRunning() {
        return running;
    }

    public static int totalCount() {
        return totalCount;
    }

    public static int renderedCount() {
        return renderedCount;
    }

    public static int failedCount() {
        return failedCount;
    }

    public static void exportAllIconsThen(Runnable done) {
        if (running) {
            return;
        }
        running = true;
        afterExport = done;
        renderedCount = 0;
        failedCount = 0;
        for (ItemStack stack : IconQueue.items()) {
            if (!isExcludedItem(stack)) {
                ITEM_QUEUE.add(stack);
            }
        }
        FLUID_QUEUE.addAll(IconQueue.fluids());
        totalCount = ITEM_QUEUE.size() + FLUID_QUEUE.size();
        SusyHeiOracleMod.LOG.info(
            "SUSY HEI oracle queued {} item icons and {} fluid icons.",
            Integer.valueOf(ITEM_QUEUE.size()),
            Integer.valueOf(FLUID_QUEUE.size())
        );
        Minecraft minecraft = Minecraft.getMinecraft();
        minecraft.displayGuiScreen(new QueuedIconExportScreen());
    }

    /**
     * Called once per frame from the export screen; renders a bounded batch so
     * the GL context stays healthy between frames.
     */
    static void processBatch() {
        int processed = 0;
        while (processed < ICON_EXPORT_BATCH_SIZE) {
            if (!ITEM_QUEUE.isEmpty()) {
                ItemStack stack = ITEM_QUEUE.poll();
                String key = ClientItemStackIconRenderer.stackKey(stack);
                if (RENDERED_KEYS.add(key)) {
                    processItem(stack, key);
                }
            } else if (!FLUID_QUEUE.isEmpty()) {
                FluidStack stack = FLUID_QUEUE.poll();
                String key = ClientFluidStackIconRenderer.fluidKey(stack);
                if (RENDERED_KEYS.add(key)) {
                    processFluid(stack, key);
                }
            } else {
                break;
            }
            processed++;
        }
    }

    private static void processItem(ItemStack stack, String key) {
        File dir = ClientItemStackIconRenderer.iconDir();
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Cannot create icon directory " + dir);
        }
        String filename = ClientItemStackIconRenderer.filenameFor(stack);
        try {
            resetTessellator();
            BufferedImage image = ClientItemStackIconRenderer.renderStackToImage(stack);
            ImageIO.write(image, "png", new File(dir, filename));
            ClientItemStackIconRenderer.recordIcon(key, filename);
            renderedCount++;
            reportProgress();
        } catch (Throwable t) {
            int attempts = recordFailure(key);
            if (attempts < MAX_RENDER_ATTEMPTS) {
                RENDERED_KEYS.remove(key);
                ITEM_QUEUE.add(stack);
            } else {
                FAILED_ITEMS.add(stack);
                fail(stack + " (after " + attempts + " attempts): " + t);
            }
        } finally {
            resetTessellator();
        }
    }

    private static int recordFailure(String key) {
        Integer current = FAILED_ATTEMPTS.get(key);
        int next = current == null ? 1 : current.intValue() + 1;
        FAILED_ATTEMPTS.put(key, Integer.valueOf(next));
        return next;
    }

    private static void processFluid(FluidStack stack, String key) {
        File dir = ClientItemStackIconRenderer.iconDir();
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Cannot create icon directory " + dir);
        }
        String filename = ClientFluidStackIconRenderer.filenameFor(stack);
        try {
            resetTessellator();
            BufferedImage image = ClientFluidStackIconRenderer.renderFluidToImage(stack);
            ImageIO.write(image, "png", new File(dir, filename));
            ClientFluidStackIconRenderer.recordIcon(key, filename);
            renderedCount++;
            reportProgress();
        } catch (Throwable t) {
            FAILED_FLUIDS.add(stack);
            fail(stack.getFluid().getName() + ": " + t);
        } finally {
            resetTessellator();
        }
    }

    private static void reportProgress() {
        if (renderedCount % ICON_PROGRESS_EVERY == 0) {
            SusyHeiOracleMod.LOG.info(
                "SUSY HEI oracle icon export progress: {}/{} rendered, {} failed.",
                Integer.valueOf(renderedCount),
                Integer.valueOf(totalCount),
                Integer.valueOf(failedCount)
            );
        }
    }

    private static void fail(String message) {
        failedCount++;
        SusyHeiOracleMod.LOG.warn("SUSY HEI oracle icon export failed: " + message);
    }

    static boolean isComplete() {
        return ITEM_QUEUE.isEmpty() && FLUID_QUEUE.isEmpty();
    }

    static void finish() {
        if (!isComplete()) {
            return;
        }
        if (afterExport == null) {
            return;
        }
        ClientItemStackIconRenderer.writeIconMap();
        ClientFluidStackIconRenderer.writeIconMap();
        SusyHeiOracleMod.LOG.info(
            "SUSY HEI oracle icon export complete: {} rendered, {} failed.",
            Integer.valueOf(renderedCount),
            Integer.valueOf(failedCount)
        );
        Runnable done = afterExport;
        afterExport = null;
        running = false;
        done.run();
    }

    /**
     * Clears leftover tessellator/GL state between renders so a stale buffer
     * from a previous icon cannot bleed into the next capture.
     */
    public static void resetTessellator() {
        try {
            Tessellator tessellator = Tessellator.getInstance();
            net.minecraft.client.renderer.BufferBuilder buffer = tessellator.getBuffer();
            // finishDrawing throws IllegalStateException when nothing is being
            // built; that is exactly the case we want to ignore.
            buffer.finishDrawing();
        } catch (Exception ignored) {
        }
        GlStateManager.color(1.0F, 1.0F, 1.0F, 1.0F);
        GlStateManager.enableTexture2D();
        GlStateManager.disableBlend();
        GlStateManager.enableAlpha();
    }
}