package dev.susyplanner.heioracle.icons;

import net.minecraft.client.gui.GuiScreen;

import java.io.IOException;

/**
 * Modal screen shown while icons export. Each draw tick renders a bounded batch
 * of item/fluid icons into offscreen framebuffers, so the GL context stays
 * valid across frames and the process can be watched/logged.
 */
public final class QueuedIconExportScreen extends GuiScreen {

    @Override
    public void drawScreen(int mouseX, int mouseY, float partialTicks) {
        if (!IconExporter.isComplete()) {
            IconExporter.processBatch();
        }
        if (IconExporter.isComplete()) {
            IconExporter.finish();
            return;
        }
        String label = "SUSY HEI Oracle: exporting icons... "
            + IconExporter.renderedCount()
            + "/"
            + IconExporter.totalCount()
            + " ("
            + IconExporter.failedCount()
            + " failed)";
        drawCenteredString(fontRenderer, label, width / 2, height / 2 - 10, 0xFFFFFF);
        super.drawScreen(mouseX, mouseY, partialTicks);
    }

    @Override
    public void handleMouseInput() throws IOException {
        // ignore input during export
    }

    @Override
    public boolean doesGuiPauseGame() {
        return false;
    }
}