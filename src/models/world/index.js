/** World model barrel: one module per previewable world model. */
import * as crate from './crate.js';
import * as barrel from './barrel.js';
import * as sandbag from './sandbag.js';
import * as palm from './palm.js';
import * as rubble from './rubble.js';
import * as tires from './tires.js';
import * as sacks from './sacks.js';
import * as well from './well.js';
import * as truck from './truck.js';
import * as windmill from './windmill.js';
import * as radar from './radar.js';
import * as cart from './cart.js';
import * as campfire from './campfire.js';
import * as aPlatform from './a-platform.js';
import * as bWreck from './b-wreck.js';
import * as pipeline from './pipeline.js';
import * as stall from './stall.js';
import * as monument from './monument.js';
import * as bazaarShop from './bazaar-shop.js';
import * as warehouse from './warehouse.js';
import * as lowWall from './low-wall.js';
import * as pillar from './pillar.js';
import * as shadeSail from './shade-sail.js';
import * as siteArch from './site-arch.js';
import * as portalArch from './portal-arch.js';
import * as tunnelArch from './tunnel-arch.js';
import * as midGate from './mid-gate.js';
import * as banner from './banner.js';
import * as flag from './flag.js';
import * as awning from './awning.js';
import * as lampPost from './lamp-post.js';
import * as flagpole from './flagpole.js';
import * as aLongShade from './a-long-shade.js';
import * as rpgLauncher from './rpg-launcher.js';

export const WORLD_MODELS = [
  { module: crate },
  { module: barrel },
  { module: sandbag },
  { module: palm },
  { module: rubble },
  { module: tires },
  { module: sacks },
  { module: well },
  { module: truck, stage: { rotY: Math.PI / 2 } },
  { module: windmill },
  { module: radar },
  { module: cart },
  { module: campfire },
  { module: aPlatform },
  { module: bWreck },
  { module: pipeline },
  { module: stall },
  { module: monument },
  { module: bazaarShop },
  { module: warehouse },
  { module: lowWall },
  { module: pillar },
  { module: shadeSail },
  { module: siteArch },
  { module: portalArch },
  { module: tunnelArch },
  { module: midGate },
  { module: banner, stage: { support: 'banner' } },
  { module: flag },
  { module: awning, stage: { support: 'awning' } },
  { module: lampPost },
  { module: flagpole },
  { module: aLongShade },
  { module: rpgLauncher, stage: { lift: true } },
];
