import { PostgresStore } from '@mastra/pg';

let pStore: PostgresStore | undefined;

export const getMastraStore = () => {
  pStore =
    pStore ||
    new PostgresStore({
      connectionString: process.env.DATABASE_URL,
    });

  return pStore;
};
