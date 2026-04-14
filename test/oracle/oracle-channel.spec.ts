import { ORACLE_CHANNEL_PORT } from '../../src/modules/oracle/oracle-channel.types';

describe('oracle-channel server', () => {
  it('exports ORACLE_CHANNEL_PORT as 7851', () => {
    expect(ORACLE_CHANNEL_PORT).toBe(7851);
  });
});
