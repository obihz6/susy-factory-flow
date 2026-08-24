package dev.susyplanner.heioracle;

import dev.susyplanner.heioracle.icons.IconExporter;
import net.minecraftforge.fml.common.FMLCommonHandler;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.event.FMLInitializationEvent;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * In-game icon exporter for the SUSY dataset. On a client launched with
 * {@code -Dsusy.oracle.autorun=true} it renders every item/fluid icon exactly as
 * the HEI (Had Enough Items) recipe viewer draws it and writes PNGs plus an
 * icon map. It mirrors the GTNH calculation oracle approach, adapted to Forge
 * 1.12.2 and the HEI ingredient registry.
 */
@Mod(modid = SusyHeiOracleMod.MODID, name = "SUSY HEI Oracle", version = SusyHeiOracleMod.VERSION)
public final class SusyHeiOracleMod {

    public static final String MODID = "susyheioracle";
    public static final String VERSION = "1.0.0";
    public static final Logger LOG = LogManager.getLogger("SUSYHeiOracle");

    private static final AtomicBoolean AUTORUN_STARTED = new AtomicBoolean(false);

    public SusyHeiOracleMod() {}

    @Mod.EventHandler
    public void init(FMLInitializationEvent event) {
        if (!Boolean.getBoolean("susy.oracle.autorun")) {
            return;
        }
        if (!FMLCommonHandler.instance().getSide().isClient()) {
            return;
        }
        try {
            Class<?> handlerClass = Class.forName("dev.susyplanner.heioracle.ClientAutorunHandler");
            Object handler = handlerClass.getConstructor().newInstance();
            net.minecraftforge.common.MinecraftForge.EVENT_BUS.register(handler);
            LOG.info("SUSY HEI oracle client autorun handler registered.");
        } catch (Throwable t) {
            LOG.error("Could not register SUSY HEI oracle client autorun handler.", t);
            FMLCommonHandler.instance().exitJava(2, false);
        }
    }

    /**
     * Renders all queued HEI item/fluid icons on the client thread and then
     * shuts the game down. Only the first caller starts the export.
     */
    public static void requestAutorunExport(String trigger) {
        if (!Boolean.getBoolean("susy.oracle.autorun")) {
            return;
        }
        if (!AUTORUN_STARTED.compareAndSet(false, true)) {
            return;
        }
        LOG.info("SUSY HEI oracle export started from {}.", trigger);
        if (Boolean.getBoolean("susy.oracle.skipIcons")) {
            LOG.info("SUSY HEI oracle skipIcons=true; jumping straight to the recipe dump.");
            RecipemapDump.runThen(new Runnable() {
                @Override
                public void run() {
                    LOG.info("SUSY HEI oracle pipeline complete; shutting down.");
                    FMLCommonHandler.instance().exitJava(0, false);
                }
            });
            return;
        }
        IconExporter.exportAllIconsThen(new Runnable() {
            @Override
            public void run() {
                LOG.info("SUSY HEI oracle icon export finished.");
                RecipemapDump.runThen(new Runnable() {
                    @Override
                    public void run() {
                        LOG.info("SUSY HEI oracle pipeline complete; shutting down.");
                        FMLCommonHandler.instance().exitJava(0, false);
                    }
                });
            }
        });
    }
}