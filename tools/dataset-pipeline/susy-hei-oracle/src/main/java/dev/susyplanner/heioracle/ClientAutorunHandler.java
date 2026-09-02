package dev.susyplanner.heioracle;

import dev.susyplanner.heioracle.icons.IconQueue;
import net.minecraft.client.Minecraft;
import net.minecraft.world.GameType;
import net.minecraft.world.WorldSettings;
import net.minecraft.world.WorldType;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.common.gameevent.TickEvent;

/**
 * On a client started with {@code -Dsusy.oracle.autorun=true} this waits for
 * the HEI ingredient registry, launches a flat singleplayer world so Forge
 * stitches the full block/item texture atlas (required for correct item
 * renders on 1.12.2), then starts the icon export and shuts the game down.
 * A real-time watchdog guarantees the export starts even if the tick loop is
 * stalled or the world cannot be loaded, so a slow or broken world never
 * blocks the oracle forever.
 */
public final class ClientAutorunHandler {

    private static final int TICKS_BEFORE_LAUNCH = Integer.getInteger("susy.oracle.autorunDelayTicks", 40);
    private static final int TICKS_BEFORE_EXPORT = Integer.getInteger("susy.oracle.worldReadyTicks", 30);
    private static final int WORLD_TIMEOUT_SECONDS = Integer.getInteger("susy.oracle.worldTimeoutSeconds", 120);
    private static final boolean SKIP_WORLD = Boolean.getBoolean("susy.oracle.skipWorld");
    private static final long REGISTRY_TIMEOUT_MILLIS = 300000L;

    private int tickCounter;
    private boolean worldRequested;
    private boolean started;
    private boolean timedOut;
    private boolean registrySeen;
    private long watchStartedAt;

    @SubscribeEvent
    public void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END || started) {
            return;
        }
        try {
            if (!registrySeen) {
                if (!IconQueue.isReady()) {
                    return;
                }
                registrySeen = true;
                watchStartedAt = System.nanoTime();
                SusyHeiOracleMod.LOG.info(
                    "SUSY HEI oracle registry ready at tick 0 (delay {} ticks, export {} ticks after world, timeout {}s).",
                    Integer.valueOf(TICKS_BEFORE_LAUNCH),
                    Integer.valueOf(TICKS_BEFORE_EXPORT),
                    Integer.valueOf(WORLD_TIMEOUT_SECONDS)
                );
            }

            tickCounter++;

            Minecraft minecraft = Minecraft.getMinecraft();
            if (minecraft == null || minecraft.getTextureManager() == null || minecraft.fontRenderer == null) {
                return;
            }

            if (!worldRequested) {
                if (tickCounter < TICKS_BEFORE_LAUNCH) {
                    return;
                }
                worldRequested = true;
                if (SKIP_WORLD) {
                    SusyHeiOracleMod.LOG.info("SUSY HEI oracle skipping world launch; exporting from title screen.");
                    startExport("title-screen");
                    return;
                }
                SusyHeiOracleMod.LOG.info("SUSY HEI oracle launching flat integrated world to stitch the texture atlas.");
                try {
                    WorldSettings settings = new WorldSettings(
                        0L,
                        GameType.CREATIVE,
                        false,
                        false,
                        WorldType.FLAT
                    );
                    minecraft.launchIntegratedServer("oracle_world", "oracle_world", settings);
                } catch (Throwable t) {
                    SusyHeiOracleMod.LOG.error("Could not launch integrated world; exporting without world.", t);
                    startExport("integrated-world-launch-failed");
                }
                return;
            }

            if (minecraft.world == null) {
                if (elapsedSeconds() > WORLD_TIMEOUT_SECONDS && !timedOut) {
                    timedOut = true;
                    SusyHeiOracleMod.LOG.warn("Integrated world did not load in time; exporting anyway.");
                    startExport("world-timeout");
                }
                return;
            }

            if (tickCounter < TICKS_BEFORE_LAUNCH + TICKS_BEFORE_EXPORT) {
                return;
            }
            startExport("world-ready");
        } catch (Throwable t) {
            SusyHeiOracleMod.LOG.error("SUSY HEI oracle autorun handler failed; exporting anyway.", t);
            startExport("handler-error");
        }
    }

    private long elapsedSeconds() {
        return (System.nanoTime() - watchStartedAt) / 1000000000L;
    }

    private void startExport(String trigger) {
        if (started) {
            return;
        }
        started = true;
        SusyHeiOracleMod.LOG.info("SUSY HEI oracle world ready; starting icon export from trigger '{}'.", trigger);
        SusyHeiOracleMod.requestAutorunExport(trigger);
    }
}