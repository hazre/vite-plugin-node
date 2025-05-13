import type { IncomingMessage, ServerResponse } from 'http';
import { exit } from 'process';
import chalk from 'chalk';
import type {
  ConfigEnv,
  Connect,
  Plugin,
  UserConfig,
  ViteDevServer,
} from 'vite';
import type {
  RequestAdapter,
  RequestAdapterOption,
  ViteConfig,
  VitePluginNodeConfig,
} from '..';
import {
  PLUGIN_NAME,
} from '..';
import { createDebugger } from '../utils';
import { ExpressHandler } from './express';
import { FastifyHandler } from './fastify';
import { KoaHandler } from './koa';
import { NestHandler } from './nest';
import { MarbleHandler } from './marble';

export const debugServer = createDebugger('vite:node-plugin:server');

export const SUPPORTED_FRAMEWORKS = {
  express: ExpressHandler,
  nest: NestHandler,
  koa: KoaHandler,
  fastify: FastifyHandler,
  marble: MarbleHandler,
};

const env: ConfigEnv = { command: 'serve', mode: '' };

export const getPluginConfig = async (
  server: ViteDevServer,
): Promise<VitePluginNodeConfig> => {
  const plugin = server.config.plugins.find(
    p => p.name === PLUGIN_NAME,
  ) as Plugin;
  let userConfig: UserConfig | null | void = null;

  if (typeof plugin.config === 'function')
    userConfig = await plugin.config({}, env);

  if (userConfig)
    return (userConfig as ViteConfig).VitePluginNodeConfig;

  console.error('Please setup VitePluginNode in your vite.config.js first');
  exit(1);
};

const getRequestHandler = (
  handler: RequestAdapterOption,
): RequestAdapter | undefined => {
  if (typeof handler === 'function') {
    debugServer(chalk.dim`using custom server handler`);
    return handler;
  }
  debugServer(chalk.dim`creating ${handler} node server`);
  return SUPPORTED_FRAMEWORKS[handler] as RequestAdapter;
};

export const createMiddleware = async (
  server: ViteDevServer,
): Promise<Connect.HandleFunction> => {
  const config = await getPluginConfig(server);
  const logger = server.config.logger;
  const requestHandler = getRequestHandler(config.adapter);
  async function _loadApp(config: VitePluginNodeConfig) {
    const appModule = await server.ssrLoadModule(config.appPath);
    let app = appModule[config.exportName!];
    if (!app) {
      logger.error(
        `${PLUGIN_NAME} Failed to find a named export ${config.exportName} from ${config.appPath}`,
      );
      throw new Error(
        `${PLUGIN_NAME} Failed to find a named export ${config.exportName} from ${config.appPath}`,
      );
    }
    app = await app;
    return app;
  }

  if (!requestHandler) {
    const errorMessage = `${PLUGIN_NAME} Failed to find a valid request handler for adapter: ${config.adapter}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  if (config.initAppOnBoot) {
    server.httpServer!.once('listening', async () => {
      let appOnBoot;
      try {
        appOnBoot = await _loadApp(config);
      } catch (loadError) {
        logger.error(
          `${PLUGIN_NAME} Failed to load application module on boot.`,
          { error: loadError instanceof Error ? loadError : new Error(String(loadError)) },
        );
        return;
      }

      if (appOnBoot) {
        if (
          config.adapter === 'nest'
          && typeof (appOnBoot as any).init === 'function'
          && !(appOnBoot as any).isInitialized
        ) {
          try {
            logger.info(
              `${PLUGIN_NAME} Initializing NestJS application on boot...`,
            );
            await (appOnBoot as any).init();
            logger.info(
              `${PLUGIN_NAME} NestJS application initialized on boot.`,
            );
          } catch (initError) {
            logger.error(
              `${PLUGIN_NAME} Failed to initialize NestJS application on boot.`,
              { error: initError instanceof Error ? initError : new Error(String(initError)) },
            );
          }
        }
      } else {
        logger.warn(
          `${PLUGIN_NAME} Application module loaded on boot, but the exported app was not found or was undefined.`,
        );
      }
    });
  }

  return async function viteNodeMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction,
  ): Promise<void> {
    try {
      const app = await _loadApp(config);
      if (app) {
        await requestHandler({ app, server, req, res, next });
      } else {
        const errorMsg = `${PLUGIN_NAME} Application instance could not be resolved for the request.`;
        logger.error(errorMsg);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end(errorMsg);
        } else {
          next(new Error(errorMsg));
        }
      }
    } catch (error) {
      logger.error(`${PLUGIN_NAME} Error during request processing:`, {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      } else {
        next(error);
      }
    }
  };
};
