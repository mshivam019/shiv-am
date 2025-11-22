#!/usr/bin/env node
import { Command } from 'commander';
import { initProject } from './commands/init.js';
import { addComponent } from './commands/add.js';
import { validateCommand } from './commands/validate.js';

const program = new Command();

program
  .name('create-shiv-am')
  .description('Backend scaffolding CLI with best practices built-in')
  .version('0.1.0');

program
  .argument('[name]', 'Project name')
  .option('--framework <framework>', 'Framework: express or hono', 'express')
  .option('--ts', 'Use TypeScript', true)
  .option('--db <database>', 'Database: pg, mysql, or none', 'pg')
  .option('--auth <auth>', 'Auth: jwt, jwks, or none', 'jwt')
  .option('--queue <queue>', 'Queue: bull or none', 'none')
  .option('--preset <preset>', 'Preset: minimal, api, or full', 'api')
  .action(initProject);

program
  .command('add <component>')
  .description('Add a component (route, middleware, service, etc.)')
  .option('-n, --name <name>', 'Component name')
  .action(addComponent);

program
  .command('validate')
  .description('Validate project structure and dependencies')
  .action(validateCommand);

program.parse();
