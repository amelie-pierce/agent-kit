import { readFileSync } from 'node:fs';

export function secondmateTemplate() {
  const charter = readFileSync(new URL('../templates/secondmate/charter.md', import.meta.url), 'utf8');
  return `${charter}\nPreview and adopt from your own Firstmate checkout:\n` +
    `  FM_SECONDMATE_CHARTER='<your responsibility and rules>' FM_SECONDMATE_SCOPE='<your scope>' bin/fm-brief.sh <id> --secondmate --no-projects\n` +
    `  # Or replace --no-projects with your own registered project names. Review the generated charter before seeding.\n` +
    `  bin/fm-home-seed.sh <id> <home|-> --no-projects\n` +
    `  # Or replace --no-projects with the same project names you reviewed above.\n` +
    `  bin/fm-spawn.sh <id> --secondmate\n`;
}
