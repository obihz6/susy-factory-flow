package dev.susyplanner.heioracle.icons;

import dev.susyplanner.heioracle.SusyHeiOracleMod;
import mezz.jei.plugins.vanilla.ingredients.fluid.FluidStackRenderer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GlStateManager;
import net.minecraft.client.shader.Framebuffer;
import net.minecraftforge.fluids.FluidStack;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;

import javax.imageio.ImageIO;
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
 * Renders a FluidStack exactly as HEI draws it (HEI's FluidStackRenderer) into
 * an offscreen framebuffer and exports a PNG. Mirrors the GTNH oracle fluid
 * renderer, adapted to Forge 1.12.2 and HEI.
 */
public final class ClientFluidStackIconRenderer {

    private static final int ICON_SIZE = Integer.getInteger("susy.oracle.iconSize", 256);
    private static final int GUI_ICON_CANVAS_SIZE = 32;
    private static final int GUI_ITEM_SIZE = 16;
    private static final float ICON_SCALE = Float.parseFloat(System.getProperty("susy.oracle.iconScale", "1.875"));
    private static final int MAX_RENDER_WARNINGS = Integer.getInteger("susy.oracle.maxFluidIconRenderWarnings", 50);
    private static final Map<String, String> ICONS_BY_FLUID_KEY = new LinkedHashMap<String, String>();
    private static int renderWarnings;

    private ClientFluidStackIconRenderer() {}

    public static String lookupIcon(FluidStack stack) {
        return captureIcon(stack);
    }

    public static void recordIcon(String key, String filename) {
        ICONS_BY_FLUID_KEY.put(key, filename);
    }

    public static String captureIcon(FluidStack stack) {
        if (stack == null || stack.getFluid() == null) {
            return null;
        }

        String key = fluidKey(stack);
        if (ICONS_BY_FLUID_KEY.containsKey(key)) {
            String value = ICONS_BY_FLUID_KEY.get(key);
            return value != null && value.length() > 0 ? value : null;
        }

        try {
            String filename = filenameFor(stack);
            ICONS_BY_FLUID_KEY.put(key, filename);
            IconExporter.queueFluid(stack.copy());
            return filename;
        } catch (Throwable t) {
            ICONS_BY_FLUID_KEY.put(key, "");
            warnRenderFailure(stack, t);
            return null;
        } finally {
            IconExporter.resetTessellator();
        }
    }

    static String filenameFor(FluidStack stack) {
        return safeName(stack) + "-" + sha1(fluidKey(stack)).substring(0, 12) + ".png";
    }

    static BufferedImage renderFluidToImage(FluidStack stack) throws Exception {
        Minecraft minecraft = Minecraft.getMinecraft();
        if (minecraft == null || minecraft.getTextureManager() == null) {
            throw new IllegalStateException("Minecraft client is not ready.");
        }

        Framebuffer framebuffer = new Framebuffer(ICON_SIZE, ICON_SIZE, true);
        ByteBuffer buffer;
        boolean projectionPushed = false;
        boolean modelViewPushed = false;

        try {
            IconExporter.resetTessellator();
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

            GL11.glPushMatrix();
            // Scale the fluid up by ICON_SCALE around its center (default 1.5x).
            GL11.glTranslatef(itemX + GUI_ITEM_SIZE / 2.0F, itemY + GUI_ITEM_SIZE / 2.0F, 0.0F);
            GL11.glScalef(ICON_SCALE, ICON_SCALE, 1.0F);
            GL11.glTranslatef(-(itemX + GUI_ITEM_SIZE / 2.0F), -(itemY + GUI_ITEM_SIZE / 2.0F), 0.0F);
            // HEI's FluidStackRenderer draws the fluid like the recipe viewer.
            new FluidStackRenderer().render(minecraft, itemX, itemY, stack);
            GL11.glPopMatrix();
            GL11.glColor4f(1.0F, 1.0F, 1.0F, 1.0F);
            GL11.glFlush();

            buffer = BufferUtils.createByteBuffer(ICON_SIZE * ICON_SIZE * 4);
            GL11.glReadPixels(0, 0, ICON_SIZE, ICON_SIZE, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, buffer);
        } finally {
            IconExporter.resetTessellator();
            GL11.glColor4f(1.0F, 1.0F, 1.0F, 1.0F);
            GlStateManager.enableAlpha();
            GlStateManager.disableBlend();
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

        return ClientItemStackIconRenderer.imageFromRgbaBuffer(buffer);
    }

    private static void warnRenderFailure(FluidStack stack, Throwable throwable) {
        renderWarnings++;
        if (renderWarnings <= MAX_RENDER_WARNINGS || renderWarnings % 1000 == 0) {
            SusyHeiOracleMod.LOG.warn(
                "SUSY HEI oracle fluid icon render failed for "
                    + stack.getFluid().getName()
                    + " ("
                    + renderWarnings
                    + " failures): "
                    + throwable.toString()
            );
        }
    }

    static String fluidKey(FluidStack stack) {
        String nbt = stack.tag == null ? "" : stack.tag.toString();
        return stack.getFluid().getName() + "#" + nbt;
    }

    private static String safeName(FluidStack stack) {
        String raw;
        try {
            raw = String.valueOf(stack.getLocalizedName());
        } catch (Throwable t) {
            raw = stack.getFluid().getName();
        }
        String safe = raw.toLowerCase().replaceAll("[^a-z0-9._-]+", "_").replaceAll("^_+|_+$", "");
        return safe.length() > 0 ? safe.substring(0, Math.min(safe.length(), 60)) : "fluid";
    }

    private static String sha1(String value) {
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

    static void writeIconMap() {
        File file = new File(ClientItemStackIconRenderer.iconDir(), "fluid-icon-map.json");
        FileWriter writer = null;
        try {
            writer = new FileWriter(file);
            writer.write("{\n");
            int index = 0;
            for (Map.Entry<String, String> entry : ICONS_BY_FLUID_KEY.entrySet()) {
                if (index > 0) {
                    writer.write(",\n");
                }
                writer.write("  \"" + jsonEscape(entry.getKey()) + "\": \"" + jsonEscape(entry.getValue()) + "\"");
                index++;
            }
            writer.write("\n}\n");
        } catch (IOException e) {
            SusyHeiOracleMod.LOG.warn("Could not write SUSY fluid icon map.", e);
        } finally {
            if (writer != null) {
                try {
                    writer.close();
                } catch (IOException ignored) {
                }
            }
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