// The production database is named exactly "sparkkindly" (staging is "sparkkindly_staging"). Importing starter
// content there is a deliberate cut-over step that needs a backup first, so it takes an explicit flag.
export function assertSafeImportTarget(databaseName: string, allowProduction: boolean): void {
  if (databaseName.trim().toLowerCase() === 'sparkkindly' && !allowProduction) {
    throw new Error(
      'Refusing to import into the production database "sparkkindly". Production import is a cut-over step that ' +
        'requires a verified backup; pass --allow-production only then.',
    );
  }
}
