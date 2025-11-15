import { register } from "./registry";
import { kMeansSolidDefinition as kMeansDefinition } from "./modules/kmeansSolid";
import { dbscanSolidDefinition as dbscanDefinition } from "./modules/dbscanSolid";

export function registerVisualizations() {
  [
    kMeansDefinition,
    dbscanDefinition,
  ].forEach(register);
}
