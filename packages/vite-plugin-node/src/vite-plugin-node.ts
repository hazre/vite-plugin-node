import type { ModuleNode, Plugin, UserConfig, ViteDevServer } from 'vite';
import type { VitePluginNodeConfig } from '.';
import chalk from 'chalk';
import { PLUGIN_NAME } from '.';
import { RollupPluginSwc } from './rollup-plugin-swc';
import { createMiddleware } from './server';
import mergeDeep from './utils';

export function VitePluginNode(cfg: VitePluginNodeConfig): Plugin[] {
  const swcOptions = mergeDeep({
    module: {
      type: 'es6',
    },
    jsc: {
      target: 'es2019',
      parser: {
        syntax: 'typescript',
        decorators: true,
      },
      transform: {
        legacyDecorator: true,
        decoratorMetadata: true,
      },
    },
  }, cfg.swcOptions ?? {});

  const config: VitePluginNodeConfig = {
    appPath: cfg.appPath,
    adapter: cfg.adapter,
    appName: cfg.appName ?? 'app',
    tsCompiler: cfg.tsCompiler ?? 'esbuild',
    exportName: cfg.exportName ?? 'viteNodeApp',
    initAppOnBoot: cfg.initAppOnBoot ?? false,
    outputFormat: cfg.outputFormat ?? 'cjs',
    swcOptions,
  };

  const plugins: Plugin[] = [
    {
      name: PLUGIN_NAME,
      config: () => {
        const plugincConfig: UserConfig & { VitePluginNodeConfig: VitePluginNodeConfig } = {
          build: {
            ssr: config.appPath,
            rollupOptions: {
              input: config.appPath,
              output: {
                format: config.outputFormat,
              },
            },
          },
          server: {
            hmr: true,
          },
          optimizeDeps: {
            noDiscovery: true,
            // Vite does not work well with optionnal dependencies,
            // mark them as ignored for now
            exclude: [
              '@swc/core',
            ],
          },
          VitePluginNodeConfig: config,
        };

        if (config.tsCompiler === 'swc')
          plugincConfig.esbuild = false;

        return plugincConfig;
      },
      configureServer: async (server) => {
        server.middlewares.use(await createMiddleware(server));
      },
      handleHotUpdate: async ({ server, modules: _modules, timestamp: _timestamp }: { server: ViteDevServer, modules: ModuleNode[], timestamp: number }) => {
        const logger = server.config.logger;

        console.warn(`[${PLUGIN_NAME}] HMR: 'handleHotUpdate' triggered. Scheduling full server restart.`);
        logger.info(
          chalk.greenBright(`[${PLUGIN_NAME}] HMR: File change detected. Scheduling server restart...`),
        );

        if (server.ws) {
          server.ws.send({
            type: 'full-reload',
            path: '*',
          });
        }

        // Schedule the restart for the next tick
        setTimeout(async () => {
          try {
            logger.info(chalk.yellow(`[${PLUGIN_NAME}] Executing scheduled server restart...`));
            await server.restart();
            logger.info(chalk.greenBright(`[${PLUGIN_NAME}] Server restart command issued successfully.`));
          } catch (error) {
            // This catch is for errors during the scheduled server.restart() itself.
            logger.error(`[${PLUGIN_NAME}] Error during scheduled server.restart():`, {
              error: error instanceof Error ? error : new Error(String(error)),
            });
          }
        }, 0); // 0ms delay to push to next event loop tick

        // Signal that this plugin has handled the modules for this HMR event
        // (by scheduling a restart), so Vite shouldn't process them further in the current sync cycle.
        return [];
      },
    },
  ];

  if (config.tsCompiler === 'swc') {
    plugins.push({
      ...RollupPluginSwc(config.swcOptions!),
    });
  }

  return plugins;
}
