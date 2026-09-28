// src/features/updates/__tests__/splitCommaSeparatedList.test.ts

import { splitCommaSeparatedList } from '../splitCommaSeparatedList';

describe('splitCommaSeparatedList', () => {
  it('trims whitespace around each entry and drops entries that are empty once trimmed', () => {
    expect(splitCommaSeparatedList(' /stack/docker-compose.yml , /stack/docker-compose.qsv.yml ,  ,'))
      .toEqual(['/stack/docker-compose.yml', '/stack/docker-compose.qsv.yml']);
  });
});
