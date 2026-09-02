package dev.susyplanner.heioracle;

import net.minecraft.server.MinecraftServer;

import java.lang.reflect.Method;

/**
 * Triggers Susy-Core's {@code /recipemapdump} command from the oracle's client
 * session so the exact instance that produced the HEI icons also produces the
 * recipe dump the dataset normalizer consumes. The command writes
 * {@code <instance>/recipedump.json} (saves dir's parent) and tolerates a null
 * server/sender, so it runs fine from the title screen (no world needed).
 *
 * Enabled with {@code -Dsusy.oracle.dumpRecipes=true}; the expected output path
 * may be passed with {@code -Dsusy.oracle.recipedumpPath} so the runner can
 * verify the file landed. Runs synchronously on the client thread after the
 * icon export finishes and before the client shuts down.
 */
public final class RecipemapDump {

    private static final boolean ENABLED = Boolean.getBoolean("susy.oracle.dumpRecipes");
    private static final String DUMP_PATH = System.getProperty("susy.oracle.recipedumpPath", "");
    private static final long TIMEOUT_MILLIS = Integer.getInteger("susy.oracle.recipedumpTimeoutSeconds", 900) * 1000L;

    private RecipemapDump() {}

    public static void runThen(Runnable done) {
        if (!ENABLED) {
            done.run();
            return;
        }
        long startedAt = System.nanoTime();
        try {
            Class<?> cls = Class.forName("supersymmetry.common.command.CommandRecipemapDump");
            Object command = cls.getConstructor().newInstance();
            Method execute = findExecute(cls);
            if (execute == null) {
                throw new IllegalStateException("CommandRecipemapDump has no executable execute method");
            }
            // net.minecraft.client.Minecraft does not implement ICommandSender,
            // and the command dereferences the sender for progress messages, so
            // pass a minimal console sender instead of null.
            SusyHeiOracleMod.LOG.info("SUSY HEI oracle triggering Susy-Core /recipemapdump.");
            execute.invoke(command, (MinecraftServer) null, consoleSender(), new String[0]);
            waitForDump();
            SusyHeiOracleMod.LOG.info(
                "SUSY HEI oracle /recipemapdump completed in {:.2f}s.",
                Double.valueOf(elapsedSeconds(startedAt))
            );
        } catch (Throwable t) {
            SusyHeiOracleMod.LOG.error("SUSY HEI oracle /recipemapdump failed; continuing.", t);
        }
        done.run();
    }

    private static Method findExecute(Class<?> cls) {
        for (String name : new String[] {"execute", "func_184881_a"}) {
            try {
                return cls.getMethod(name, MinecraftServer.class, net.minecraft.command.ICommandSender.class, String[].class);
            } catch (NoSuchMethodException ignored) {
                // try the next runtime method name
            }
        }
        return null;
    }

    /**
     * Minimal ICommandSender so Susy-Core's progress messages land in the
     * oracle log; the dump command dereferences the sender unguarded.
     */
    private static net.minecraft.command.ICommandSender consoleSender() {
        return new net.minecraft.command.ICommandSender() {
            @Override
            public String getName() {
                return "SUSY Oracle";
            }

            @Override
            public boolean canUseCommand(int permission, String commandName) {
                return true;
            }

            @Override
            public net.minecraft.world.World getEntityWorld() {
                return null;
            }

            @Override
            public MinecraftServer getServer() {
                return null;
            }

            @Override
            public void sendMessage(net.minecraft.util.text.ITextComponent component) {
                SusyHeiOracleMod.LOG.info("[recipemapdump] {}", component.getUnformattedText());
            }
        };
    }

    private static void waitForDump() {
        if (DUMP_PATH.isEmpty()) {
            return;
        }
        java.io.File target = new java.io.File(DUMP_PATH);
        long deadline = System.currentTimeMillis() + TIMEOUT_MILLIS;
        long lastSize = -1L;
        long stableSince = 0L;
        while (System.currentTimeMillis() < deadline) {
            if (target.exists()) {
                long size = target.length();
                if (size == lastSize && size > 0L) {
                    if (stableSince == 0L) {
                        stableSince = System.currentTimeMillis();
                    } else if (System.currentTimeMillis() - stableSince >= 3000L) {
                        SusyHeiOracleMod.LOG.info(
                            "SUSY HEI oracle recipedump.json present ({} bytes).",
                            Long.valueOf(size)
                        );
                        return;
                    }
                } else {
                    lastSize = size;
                    stableSince = 0L;
                }
            }
            try {
                Thread.sleep(1000L);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        SusyHeiOracleMod.LOG.warn("SUSY HEI oracle timed out waiting for {}; proceeding.", DUMP_PATH);
    }

    private static double elapsedSeconds(long startedAt) {
        return (System.nanoTime() - startedAt) / 1000000000.0d;
    }
}