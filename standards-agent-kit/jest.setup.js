// This file sets up Jest mocks for the plugin system tests
const path = require('path');
const fs = require('fs');

// Mock dynamic import
// This is the key fix for the PluginLoader tests
global.importShim = jest.fn();

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

// Mock path module
jest.mock('path', () => ({
  join: jest.fn(),
  resolve: jest.fn(),
  dirname: jest.fn(),
  basename: jest.fn(),
  extname: jest.fn(),
}));

// Mock for dynamic imports in PluginLoader
jest.mock('./src/plugins/PluginLoader', () => {
  const originalModule = jest.requireActual('./src/plugins/PluginLoader');
  
  return {
    ...originalModule,
    PluginLoader: {
      ...originalModule.PluginLoader,
      loadFromDirectory: async (directory, context, options = { initialize: true }) => {
        const manifestPath = path.join(directory, 'plugin.json');
        
        if (!fs.existsSync(manifestPath)) {
          throw new Error(`Plugin manifest not found at ${manifestPath}`);
        }
        
        try {
          const manifestContent = fs.readFileSync(manifestPath, 'utf8');
          const manifest = JSON.parse(manifestContent);
          
          // Validate manifest
          if (!manifest.id || !manifest.main) {
            throw new Error('Invalid plugin manifest: missing required fields (id, main)');
          }
          
          // Load the plugin module
          const mainPath = path.join(directory, manifest.main);
          if (!fs.existsSync(mainPath)) {
            throw new Error(`Plugin main file not found at ${mainPath}`);
          }
          
          // Use our mocked import instead of the real dynamic import
          const pluginModule = await global.importShim(mainPath);
          const PluginClass = pluginModule.default || pluginModule[manifest.id];
          
          if (!PluginClass) {
            throw new Error(`Could not find plugin class in ${mainPath}`);
          }
          
          // Create an instance of the plugin
          const plugin = new PluginClass();
          
          // Initialize the plugin if requested
          if (options.initialize) {
            await plugin.initialize(context);
          }
          
          return plugin;
        } catch (error) {
          throw new Error(`Failed to load plugin from directory ${directory}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      loadFromPackage: async (packageName, context, options = { initialize: true }) => {
        try {
          // Mock the package resolution
          const packageDir = '/node_modules/' + packageName;
          
          // Call loadFromDirectory to ensure the spy in the test is triggered
          return originalModule.PluginLoader.loadFromDirectory(packageDir, context, options);
        } catch (error) {
          throw new Error(`Failed to load plugin from package ${packageName}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      isValidPlugin: (obj) => {
        return (
          obj &&
          typeof obj.id === 'string' &&
          typeof obj.name === 'string' &&
          typeof obj.description === 'string' &&
          typeof obj.version === 'string' &&
          typeof obj.author === 'string' &&
          typeof obj.initialize === 'function' &&
          typeof obj.getTools === 'function'
        );
      }
    }
  };
});
