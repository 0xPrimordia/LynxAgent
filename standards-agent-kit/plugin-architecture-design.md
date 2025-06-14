# Plugin Architecture Design for Standards Agent Kit

## Overview

The Standards Agent Kit currently provides a set of LangChain tools that enable AI agents to interact with the Hedera network using the HCS-10 OpenConvAI standard. To enhance its functionality and allow for community contributions, we propose adding a plugin system that will enable developers to extend the kit with custom integrations.

## Design Goals

1. **Modularity**: Allow plugins to be developed independently and integrated seamlessly
2. **Discoverability**: Make it easy for agents to discover and use available plugins
3. **Standardization**: Provide a consistent interface for all plugins
4. **Extensibility**: Support various types of integrations (DeFi protocols, web2 services, etc.)
5. **Simplicity**: Keep the plugin development process straightforward

## Plugin Architecture

### Core Components

1. **Plugin Registry**: Central system for registering, discovering, and loading plugins
2. **Plugin Interface**: Standard interface that all plugins must implement
3. **Plugin Loader**: Mechanism to dynamically load plugins at runtime
4. **Plugin Context**: Shared context that provides access to the HCS10Client and other resources

### Plugin Interface

Each plugin will implement a standard interface:

```typescript
export interface IPlugin {
  // Unique identifier for the plugin
  id: string;
  
  // Human-readable name of the plugin
  name: string;
  
  // Description of what the plugin does
  description: string;
  
  // Version of the plugin
  version: string;
  
  // Author of the plugin
  author: string;
  
  // Initialize the plugin with the provided context
  initialize(context: PluginContext): Promise<void>;
  
  // Get the tools provided by this plugin
  getTools(): StructuredTool[];
  
  // Clean up resources when the plugin is unloaded
  cleanup?(): Promise<void>;
}
```

### Plugin Context

The plugin context provides access to shared resources:

```typescript
export interface PluginContext {
  // The HCS10Client instance
  client: HCS10Client;
  
  // Optional state manager
  stateManager?: IStateManager;
  
  // Logger instance
  logger: Logger;
  
  // Configuration options
  config: Record<string, any>;
}
```

### Plugin Registry

The plugin registry manages the lifecycle of plugins:

```typescript
export class PluginRegistry {
  private plugins: Map<string, IPlugin> = new Map();
  private context: PluginContext;
  
  constructor(context: PluginContext) {
    this.context = context;
  }
  
  // Register a plugin
  async registerPlugin(plugin: IPlugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin with ID ${plugin.id} is already registered`);
    }
    
    await plugin.initialize(this.context);
    this.plugins.set(plugin.id, plugin);
  }
  
  // Get a plugin by ID
  getPlugin(id: string): IPlugin | undefined {
    return this.plugins.get(id);
  }
  
  // Get all registered plugins
  getAllPlugins(): IPlugin[] {
    return Array.from(this.plugins.values());
  }
  
  // Get all tools from all plugins
  getAllTools(): StructuredTool[] {
    return this.getAllPlugins().flatMap(plugin => plugin.getTools());
  }
  
  // Unregister a plugin
  async unregisterPlugin(id: string): Promise<boolean> {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      return false;
    }
    
    if (plugin.cleanup) {
      await plugin.cleanup();
    }
    
    return this.plugins.delete(id);
  }
}
```

### Plugin Base Class

To simplify plugin development, we'll provide a base class:

```typescript
export abstract class BasePlugin implements IPlugin {
  abstract id: string;
  abstract name: string;
  abstract description: string;
  abstract version: string;
  abstract author: string;
  
  protected context!: PluginContext;
  
  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
  }
  
  abstract getTools(): StructuredTool[];
  
  async cleanup(): Promise<void> {
    // Default implementation does nothing
  }
}
```

## Integration with Standards Agent Kit

### Main Entry Point

The plugin system will be integrated into the main entry point of the Standards Agent Kit:

```typescript
// src/plugins/index.ts
export * from './PluginInterface';
export * from './PluginRegistry';
export * from './BasePlugin';

// src/index.ts
export * from './hcs10';
export * from './tools';
export * from './state';
export * from './plugins';
export * from './init';
```

### Initialization

The plugin system will be initialized as part of the agent setup:

```typescript
// Example usage in application code
import { HCS10Client, PluginRegistry, IPlugin } from '@hashgraphonline/standards-agent-kit';
import { WeatherPlugin } from './plugins/weather-plugin';
import { DeFiPlugin } from './plugins/defi-plugin';

async function setupAgent() {
  // Initialize HCS10Client
  const client = new HCS10Client({
    operatorId: process.env.HEDERA_ACCOUNT_ID!,
    operatorKey: process.env.HEDERA_PRIVATE_KEY!,
    network: 'testnet'
  });
  
  // Create plugin context
  const context = {
    client,
    logger: Logger.getInstance(),
    config: {
      // Global configuration options
    }
  };
  
  // Initialize plugin registry
  const pluginRegistry = new PluginRegistry(context);
  
  // Register plugins
  await pluginRegistry.registerPlugin(new WeatherPlugin());
  await pluginRegistry.registerPlugin(new DeFiPlugin());
  
  // Get all tools including plugin tools
  const allTools = [
    ...standardTools,
    ...pluginRegistry.getAllTools()
  ];
  
  // Create LangChain agent with all tools
  const agent = createOpenAIToolsAgent({
    llm,
    tools: allTools,
    prompt
  });
  
  return agent;
}
```

## Example Plugin Implementation

### Weather API Plugin

```typescript
import { BasePlugin, StructuredTool } from '@hashgraphonline/standards-agent-kit';
import { z } from 'zod';
import axios from 'axios';

export class WeatherPlugin extends BasePlugin {
  id = 'weather-api';
  name = 'Weather API Plugin';
  description = 'Provides tools to access weather data';
  version = '1.0.0';
  author = 'Hashgraph Online';
  
  private apiKey?: string;
  
  async initialize(context: PluginContext): Promise<void> {
    await super.initialize(context);
    this.apiKey = context.config.weatherApiKey;
    
    if (!this.apiKey) {
      this.context.logger.warn('Weather API key not provided. Weather tools may not function correctly.');
    }
  }
  
  getTools(): StructuredTool[] {
    return [
      new GetCurrentWeatherTool(this.apiKey),
      new GetWeatherForecastTool(this.apiKey)
    ];
  }
}

class GetCurrentWeatherTool extends StructuredTool {
  name = 'get_current_weather';
  description = 'Get the current weather for a location';
  
  schema = z.object({
    location: z.string().describe('The city and state, e.g. San Francisco, CA'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().describe('The unit of temperature')
  });
  
  constructor(private apiKey?: string) {
    super();
  }
  
  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    if (!this.apiKey) {
      return 'Error: Weather API key not configured';
    }
    
    try {
      const response = await axios.get('https://api.weatherapi.com/v1/current.json', {
        params: {
          key: this.apiKey,
          q: input.location,
          aqi: 'no'
        }
      });
      
      const data = response.data;
      const temp = input.unit === 'fahrenheit' 
        ? data.current.temp_f 
        : data.current.temp_c;
      const unit = input.unit === 'fahrenheit' ? '°F' : '°C';
      
      return `Current weather in ${data.location.name}, ${data.location.country}: ${data.current.condition.text}, ${temp}${unit}`;
    } catch (error) {
      return `Error fetching weather data: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

// Additional weather tools would be implemented here
```

### DeFi Integration Plugin

```typescript
import { BasePlugin, StructuredTool } from '@hashgraphonline/standards-agent-kit';
import { z } from 'zod';

export class DeFiPlugin extends BasePlugin {
  id = 'defi-integration';
  name = 'DeFi Integration Plugin';
  description = 'Provides tools to interact with DeFi protocols on Hedera';
  version = '1.0.0';
  author = 'Hashgraph Online';
  
  getTools(): StructuredTool[] {
    return [
      new GetTokenPriceTool(this.context.client),
      new SwapTokensTool(this.context.client)
    ];
  }
}

// DeFi tools would be implemented here
```

## Plugin Discovery and Loading

To support dynamic discovery and loading of plugins, we'll implement:

1. **Plugin Manifest**: JSON file that describes the plugin
2. **Plugin Loader**: Utility to load plugins from npm packages or local directories

```typescript
// Plugin manifest (plugin.json)
{
  "id": "weather-api",
  "name": "Weather API Plugin",
  "description": "Provides tools to access weather data",
  "version": "1.0.0",
  "author": "Hashgraph Online",
  "main": "dist/index.js",
  "config": {
    "required": ["weatherApiKey"],
    "optional": ["cacheTimeout"]
  }
}

// Plugin loader
export class PluginLoader {
  static async loadFromDirectory(directory: string, context: PluginContext): Promise<IPlugin> {
    const manifestPath = path.join(directory, 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    const pluginModule = await import(path.join(directory, manifest.main));
    const PluginClass = pluginModule.default || pluginModule[manifest.id];
    
    if (!PluginClass) {
      throw new Error(`Could not find plugin class in ${manifest.main}`);
    }
    
    return new PluginClass();
  }
  
  static async loadFromPackage(packageName: string, context: PluginContext): Promise<IPlugin> {
    const packagePath = require.resolve(packageName);
    const packageDir = path.dirname(packagePath);
    
    return this.loadFromDirectory(packageDir, context);
  }
}
```

## Directory Structure

The plugin system will be organized as follows:

```
src/
├── hcs10/
├── state/
├── tools/
├── utils/
├── plugins/
│   ├── index.ts
│   ├── PluginInterface.ts
│   ├── PluginRegistry.ts
│   ├── PluginContext.ts
│   ├── BasePlugin.ts
│   └── PluginLoader.ts
├── index.ts
└── init.ts
```

## Implementation Plan

1. Create the plugin system core components
2. Integrate the plugin system with the Standards Agent Kit
3. Develop example plugins (Weather API, DeFi integration)
4. Update documentation with plugin development guidelines
5. Create tests for the plugin system

## Conclusion

This plugin architecture will enable the Standards Agent Kit to be extended with various integrations, allowing the community to contribute and enhance its functionality. The design focuses on simplicity, standardization, and extensibility, making it accessible to developers while maintaining the robustness of the core system.
