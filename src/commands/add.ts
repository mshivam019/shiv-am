import prompts from 'prompts';
import chalk from 'chalk';
import { addRoute } from '../generators/route.js';
import { addMiddleware } from '../generators/middleware.js';
import { addService } from '../generators/service.js';

export async function addComponent(component: string, options: any) {
  const validComponents = ['route', 'middleware', 'service', 'controller'];
  
  if (!validComponents.includes(component)) {
    console.log(chalk.red(`\n❌ Invalid component: ${component}`));
    console.log(chalk.gray(`Valid components: ${validComponents.join(', ')}\n`));
    process.exit(1);
  }

  let name = options.name;

  if (!name) {
    const response = await prompts({
      type: 'text',
      name: 'name',
      message: `${component.charAt(0).toUpperCase() + component.slice(1)} name:`
    });
    name = response.name;
  }

  if (!name) {
    console.log(chalk.red('\n❌ Name is required'));
    process.exit(1);
  }

  try {
    switch (component) {
      case 'route':
        await addRoute(name);
        break;
      case 'middleware':
        await addMiddleware(name);
        break;
      case 'service':
        await addService(name);
        break;
      case 'controller':
        console.log(chalk.yellow('Controller generation coming soon!'));
        break;
    }
    
    console.log(chalk.green(`\n✅ ${component} '${name}' added successfully!\n`));
  } catch (error) {
    console.log(chalk.red(`\n❌ Failed to add ${component}`));
    console.error(error);
    process.exit(1);
  }
}
