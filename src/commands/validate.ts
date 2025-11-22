import chalk from 'chalk';
import { validateProject, printValidationErrors } from '../validators/project.js';

export async function validateCommand() {
  console.log(chalk.blue('\n🔍 Validating project...\n'));

  const projectRoot = process.cwd();
  const errors = await validateProject(projectRoot);

  printValidationErrors(errors);

  if (errors.length > 0) {
    process.exit(1);
  }
}
