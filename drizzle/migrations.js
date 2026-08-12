// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_freezing_doctor_strange.sql';
import m0001 from './0001_pale_bloodstrike.sql';
import m0002 from './0002_clumsy_komodo.sql';
import m0003 from './0003_nebulous_thunderbolt.sql';
import m0004 from './0004_curious_speed.sql';
import m0005 from './0005_confused_silver_centurion.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005
    }
  }
  