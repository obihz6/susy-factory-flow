package dev.susyplanner.heioracle.icons;

import dev.susyplanner.heioracle.SusyHeiOracleMod;
import mezz.jei.plugins.vanilla.ingredients.item.ItemStackRenderer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GlStateManager;
import net.minecraft.client.renderer.RenderHelper;
import net.minecraft.client.shader.Framebuffer;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.oredict.OreDictionary;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL12;

import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Renders an ItemStack exactly as HEI draws it (vanilla RenderItem driven by
 * HEI's ItemStackRenderer) into an offscreen framebuffer and exports a PNG.
 * Mirrors the GTNH oracle ClientItemStackIconRenderer, adapted to Forge 1.12.2.
 */
public final class ClientItemStackIconRenderer {

    private static final int ICON_SIZE = Integer.getInteger("susy.oracle.iconSize", 256);
    private static final int GUI_ICON_CANVAS_SIZE = 32;
    private static final int GUI_ITEM_SIZE = 16;
    private static final float ICON_SCALE = Float.parseFloat(System.getProperty("susy.oracle.iconScale", "1.875"));
    private static final int ICON_EXPORT_BATCH_SIZE = Integer.getInteger("susy.oracle.iconExportBatchSize", 64);
    private static final int ICON_PROGRESS_EVERY = Integer.getInteger("susy.oracle.iconProgressEvery", 256);
    private static final int MAX_RENDER_WARNINGS = Integer.getInteger("susy.oracle.maxIconRenderWarnings", 50);
    private static final Map<String, String> ICONS_BY_STACK_KEY = new LinkedHashMap<String, String>();
    private static int renderWarnings;

    private ClientItemStackIconRenderer() {}

    public static String lookupIcon(ItemStack stack) {
        return captureIcon(stack);
    }

    public static void recordIcon(String key, String filename) {
        ICONS_BY_STACK_KEY.put(key, filename);
    }

    public static String captureIcon(ItemStack stack) {
        if (stack == null || stack.getItem() == null || stack.getCount() <= 0) {
            return null;
        }

        String key = stackKey(stack);
        if (ICONS_BY_STACK_KEY.containsKey(key)) {
            String value = ICONS_BY_STACK_KEY.get(key);
            return value != null && value.length() > 0 ? value : null;
        }

        try {
            ItemStack renderStack = renderableStack(stack);
            String renderKey = stackKey(renderStack);
            String filename = existingIconFilename(renderKey);
            if (filename == null) {
                filename = filenameFor(renderStack);
                ICONS_BY_STACK_KEY.put(renderKey, filename);
                IconExporter.queueItem(renderStack);
            }
            ICONS_BY_STACK_KEY.put(key, filename);
            return filename;
        } catch (Throwable t) {
            ICONS_BY_STACK_KEY.put(key, "");
            warnRenderFailure(stack, t);
            return null;
        }
    }

    static String filenameFor(ItemStack stack) {
        return safeName(stack) + "-" + sha1(stackKey(stack)).substring(0, 12) + ".png";
    }

    private static ItemStack renderableStack(ItemStack stack) {
        ItemStack renderStack = stack.copy();
        renderStack.setCount(1);
        if (renderStack.getItemDamage() == OreDictionary.WILDCARD_VALUE) {
            renderStack.setItemDamage(0);
        }
        return renderStack;
    }

    private static String existingIconFilename(String key) {
        if (!ICONS_BY_STACK_KEY.containsKey(key)) {
            return null;
        }
        String value = ICONS_BY_STACK_KEY.get(key);
        return value != null && value.length() > 0 ? value : null;
    }

    static BufferedImage renderStackToImage(ItemStack stack) throws Exception {
        Minecraft minecraft = Minecraft.getMinecraft();
        if (minecraft == null || minecraft.getTextureManager() == null) {
            throw new IllegalStateException("Minecraft client is not ready.");
        }

        Framebuffer framebuffer = new Framebuffer(ICON_SIZE, ICON_SIZE, true);
        ByteBuffer buffer;
        boolean projectionPushed = false;
        boolean modelViewPushed = false;

        try {
            framebuffer.bindFramebuffer(true);

            GL11.glViewport(0, 0, ICON_SIZE, ICON_SIZE);
            GL11.glClearColor(0.0F, 0.0F, 0.0F, 0.0F);
            GL11.glClear(GL11.GL_COLOR_BUFFER_BIT | GL11.GL_DEPTH_BUFFER_BIT);

            GL11.glMatrixMode(GL11.GL_PROJECTION);
            GL11.glPushMatrix();
            projectionPushed = true;
            GL11.glLoadIdentity();
            GL11.glOrtho(0.0D, GUI_ICON_CANVAS_SIZE, GUI_ICON_CANVAS_SIZE, 0.0D, 1000.0D, 3000.0D);

            GL11.glMatrixMode(GL11.GL_MODELVIEW);
            GL11.glPushMatrix();
            modelViewPushed = true;
            GL11.glLoadIdentity();
            GL11.glTranslatef(0.0F, 0.0F, -2000.0F);

            int itemX = (GUI_ICON_CANVAS_SIZE - GUI_ITEM_SIZE) / 2;
            int itemY = (GUI_ICON_CANVAS_SIZE - GUI_ITEM_SIZE) / 2;

            RenderHelper.enableGUIStandardItemLighting();
            GlStateManager.enableDepth();
            GL11.glPushMatrix();
            // Scale the item up by ICON_SCALE around its center so the sprite
            // fills more of the icon canvas (default 1.5x).
            GL11.glTranslatef(itemX + GUI_ITEM_SIZE / 2.0F, itemY + GUI_ITEM_SIZE / 2.0F, 0.0F);
            GL11.glScalef(ICON_SCALE, ICON_SCALE, 1.0F);
            GL11.glTranslatef(-(itemX + GUI_ITEM_SIZE / 2.0F), -(itemY + GUI_ITEM_SIZE / 2.0F), 0.0F);
            // HEI's ItemStackRenderer renders the stack exactly like the recipe
            // viewer does (vanilla RenderItem under the hood).
            new ItemStackRenderer().render(minecraft, itemX, itemY, stack);
            GL11.glPopMatrix();
            GlStateManager.disableDepth();
            RenderHelper.disableStandardItemLighting();
            GL11.glDisable(GL12.GL_RESCALE_NORMAL);
            GL11.glFlush();

            buffer = BufferUtils.createByteBuffer(ICON_SIZE * ICON_SIZE * 4);
            GL11.glReadPixels(0, 0, ICON_SIZE, ICON_SIZE, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, buffer);
        } finally {
            RenderHelper.disableStandardItemLighting();
            GlStateManager.disableDepth();
            if (modelViewPushed) {
                GL11.glMatrixMode(GL11.GL_MODELVIEW);
                GL11.glPopMatrix();
            }
            if (projectionPushed) {
                GL11.glMatrixMode(GL11.GL_PROJECTION);
                GL11.glPopMatrix();
            }
            GL11.glMatrixMode(GL11.GL_MODELVIEW);
            framebuffer.unbindFramebuffer();
            framebuffer.deleteFramebuffer();
        }

        return imageFromRgbaBuffer(buffer);
    }

    static BufferedImage imageFromRgbaBuffer(ByteBuffer buffer) {
        BufferedImage image = new BufferedImage(ICON_SIZE, ICON_SIZE, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < ICON_SIZE; y++) {
            for (int x = 0; x < ICON_SIZE; x++) {
                int index = (x + (ICON_SIZE - 1 - y) * ICON_SIZE) * 4;
                int red = buffer.get(index) & 255;
                int green = buffer.get(index + 1) & 255;
                int blue = buffer.get(index + 2) & 255;
                int alpha = buffer.get(index + 3) & 255;
                image.setRGB(x, y, (alpha << 24) | (red << 16) | (green << 8) | blue);
            }
        }
        return image;
    }

    static boolean imageHasVisiblePixels(BufferedImage image) {
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                if (((image.getRGB(x, y) >>> 24) & 255) > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    private static double missingTextureRatio(BufferedImage image) {
        int visiblePixels = 0;
        int missingTexturePixels = 0;
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                int value = image.getRGB(x, y);
                int alpha = (value >>> 24) & 255;
                if (alpha == 0) {
                    continue;
                }
                visiblePixels++;
                int red = (value >> 16) & 255;
                int green = (value >> 8) & 255;
                int blue = value & 255;
                if (red >= 220 && green <= 40 && blue >= 220) {
                    missingTexturePixels++;
                }
            }
        }
        return visiblePixels > 0 ? (double) missingTexturePixels / (double) visiblePixels : 0.0D;
    }

    private static void warnRenderFailure(ItemStack stack, Throwable throwable) {
        renderWarnings++;
        if (renderWarnings <= MAX_RENDER_WARNINGS || renderWarnings % 1000 == 0) {
            SusyHeiOracleMod.LOG.warn(
                "SUSY HEI oracle icon render failed for "
                    + stack
                    + " ("
                    + renderWarnings
                    + " failures): "
                    + throwable.toString()
            );
        }
    }

    static File iconDir() {
        String configured = System.getProperty("susy.oracle.iconDir");
        if (configured != null && configured.trim().length() > 0) {
            return new File(configured);
        }
        return new File("rendered-icons");
    }

    static void writeIconMap() {
        File file = new File(iconDir(), "icon-map.json");
        FileWriter writer = null;
        try {
            writer = new FileWriter(file);
            writer.write("{\n");
            int index = 0;
            for (Map.Entry<String, String> entry : ICONS_BY_STACK_KEY.entrySet()) {
                if (index > 0) {
                    writer.write(",\n");
                }
                writer.write("  \"" + jsonEscape(entry.getKey()) + "\": \"" + jsonEscape(entry.getValue()) + "\"");
                index++;
            }
            writer.write("\n}\n");
        } catch (IOException e) {
            SusyHeiOracleMod.LOG.warn("Could not write SUSY item icon map.", e);
        } finally {
            if (writer != null) {
                try {
                    writer.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    static String stackKey(ItemStack stack) {
        String nbt = stack.hasTagCompound() ? stack.getTagCompound().toString() : "";
        return registryName(stack) + "@" + stack.getItemDamage() + "#" + nbt;
    }

    static String registryName(ItemStack stack) {
        try {
            ResourceLocation registryName = stack.getItem().getRegistryName();
            if (registryName != null) {
                return registryName.toString();
            }
        } catch (Throwable ignored) {
        }
        return String.valueOf(Item.REGISTRY.getNameForObject(stack.getItem()));
    }

    private static String safeName(ItemStack stack) {
        String raw;
        try {
            raw = String.valueOf(stack.getDisplayName());
        } catch (Throwable t) {
            raw = registryName(stack);
        }
        String safe = raw.toLowerCase().replaceAll("[^a-z0-9._-]+", "_").replaceAll("^_+|_+$", "");
        return safe.length() > 0 ? safe.substring(0, Math.min(safe.length(), 60)) : "item";
    }

    static String sha1(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            for (byte b : bytes) {
                builder.append(String.format("%02x", b & 255));
            }
            return builder.toString();
        } catch (Exception e) {
            throw new RuntimeException("SHA-1 unavailable", e);
        }
    }

    private static String jsonEscape(String value) {
        return String.valueOf(value)
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }
}