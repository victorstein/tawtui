import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';

async function bootstrap() {
  await CommandFactory.run(AppModule, {
    errorHandler: (err) => {
      console.error(err);
      process.exit(1);
    },
  });
}

void bootstrap();
