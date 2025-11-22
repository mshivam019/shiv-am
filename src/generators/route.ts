import prompts from 'prompts';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';

export async function addRoute(name: string) {
  const response = await prompts([
    {
      type: 'select',
      name: 'method',
      message: 'HTTP method:',
      choices: [
        { title: 'GET', value: 'get' },
        { title: 'POST', value: 'post' },
        { title: 'PUT', value: 'put' },
        { title: 'DELETE', value: 'delete' },
        { title: 'PATCH', value: 'patch' }
      ]
    },
    {
      type: 'text',
      name: 'path',
      message: 'Route path:',
      initial: `/${name}`
    },
    {
      type: 'confirm',
      name: 'createController',
      message: 'Create controller?',
      initial: true
    },
    {
      type: 'confirm',
      name: 'createService',
      message: 'Create service?',
      initial: true
    },
    {
      type: 'multiselect',
      name: 'middleware',
      message: 'Include middleware (optional):',
      choices: [
        { title: 'Auth', value: 'authMiddleware' },
        { title: 'Logging', value: 'loggingMiddleware' },
        { title: 'Role Check', value: 'roleMiddleware' }
      ]
    }
  ]);

  const projectRoot = process.cwd();
  
  // Create service if requested
  if (response.createService) {
    await createService(projectRoot, name);
  }

  // Create controller if requested
  if (response.createController) {
    await createController(projectRoot, name, response.createService);
  }

  // Add route to routes file
  await addRouteToFile(projectRoot, name, response);
}

async function createService(projectRoot: string, name: string) {
  const servicePath = path.join(projectRoot, 'src/services', `${name}.ts`);
  
  const serviceContent = `export const ${name}Service = {
  async get${capitalize(name)}() {
    // TODO: Implement service logic
    return { message: 'Service ${name} response' };
  },

  async create${capitalize(name)}(data: any) {
    // TODO: Implement service logic
    return { success: true, data };
  },

  async update${capitalize(name)}(id: string, data: any) {
    // TODO: Implement service logic
    return { success: true, id, data };
  },

  async delete${capitalize(name)}(id: string) {
    // TODO: Implement service logic
    return { success: true, id };
  }
};
`;

  await fs.outputFile(servicePath, serviceContent);
  console.log(chalk.green(`✓ Created service: ${servicePath}`));
}

async function createController(projectRoot: string, name: string, hasService: boolean) {
  const controllerPath = path.join(projectRoot, 'src/controllers', `${name}.ts`);
  
  // Detect framework
  const packageJson = JSON.parse(
    await fs.readFile(path.join(projectRoot, 'package.json'), 'utf-8')
  );
  const isHono = packageJson.dependencies?.hono;

  let controllerContent = '';

  if (isHono) {
    controllerContent = `import { Context } from 'hono';
${hasService ? `import { ${name}Service } from '../services/${name}';` : ''}

export const ${name}Controller = {
  async get${capitalize(name)}(c: Context) {
    try {
      ${hasService ? `const data = await ${name}Service.get${capitalize(name)}();` : `const data = { message: 'Hello from ${name}' };`}
      return c.json(data);
    } catch (error) {
      return c.json({ error: 'Failed to get ${name}' }, 500);
    }
  },

  async create${capitalize(name)}(c: Context) {
    try {
      const body = await c.req.json();
      ${hasService ? `const data = await ${name}Service.create${capitalize(name)}(body);` : `const data = { success: true, body };`}
      return c.json(data, 201);
    } catch (error) {
      return c.json({ error: 'Failed to create ${name}' }, 500);
    }
  }
};
`;
  } else {
    controllerContent = `import { Request, Response } from 'express';
${hasService ? `import { ${name}Service } from '../services/${name}';` : ''}

export const ${name}Controller = {
  async get${capitalize(name)}(req: Request, res: Response) {
    try {
      ${hasService ? `const data = await ${name}Service.get${capitalize(name)}();` : `const data = { message: 'Hello from ${name}' };`}
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get ${name}' });
    }
  },

  async create${capitalize(name)}(req: Request, res: Response) {
    try {
      ${hasService ? `const data = await ${name}Service.create${capitalize(name)}(req.body);` : `const data = { success: true, body: req.body };`}
      res.status(201).json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create ${name}' });
    }
  }
};
`;
  }

  await fs.outputFile(controllerPath, controllerContent);
  console.log(chalk.green(`✓ Created controller: ${controllerPath}`));
}

async function addRouteToFile(projectRoot: string, name: string, config: any) {
  const routesPath = path.join(projectRoot, 'src/routes/index.ts');
  
  try {
    let content = await fs.readFile(routesPath, 'utf-8');
    
    // Add import
    const importLine = `import { ${name}Controller } from '../controllers/${name}';`;
    if (!content.includes(importLine)) {
      const lastImport = content.lastIndexOf('import');
      const endOfLastImport = content.indexOf('\n', lastImport);
      content = content.slice(0, endOfLastImport + 1) + importLine + '\n' + content.slice(endOfLastImport + 1);
    }

    // Add middleware imports if needed
    if (config.middleware && config.middleware.length > 0) {
      for (const mw of config.middleware) {
        const mwImport = `import { ${mw} } from '../middleware/auth';`;
        if (!content.includes(mwImport)) {
          const lastImport = content.lastIndexOf('import');
          const endOfLastImport = content.indexOf('\n', lastImport);
          content = content.slice(0, endOfLastImport + 1) + mwImport + '\n' + content.slice(endOfLastImport + 1);
        }
      }
    }

    // Add route
    const middlewareChain = config.middleware && config.middleware.length > 0 
      ? config.middleware.join(', ') + ', ' 
      : '';
    
    const routeLine = `router.${config.method}('${config.path}', ${middlewareChain}${name}Controller.get${capitalize(name)});`;
    
    // Find the last route definition
    const lastRouterCall = content.lastIndexOf('router.');
    if (lastRouterCall !== -1) {
      const endOfLastRoute = content.indexOf('\n', lastRouterCall);
      content = content.slice(0, endOfLastRoute + 1) + routeLine + '\n' + content.slice(endOfLastRoute + 1);
    } else {
      content += '\n' + routeLine + '\n';
    }

    await fs.outputFile(routesPath, content);
    console.log(chalk.green(`✓ Added route to: ${routesPath}`));
  } catch (error) {
    console.error(chalk.red('Failed to update routes file:'), error);
  }
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
