// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// On, off, speed, direction, whoosh and light are already Gladys scene actions
// on the device features. This one does what a scene cannot: run the fan
// harder for a while, then put it back as it was before (off, its speed, or
// auto), unless someone changed it meanwhile.
//
// The trigger (`fan_changed_outside_gladys`) is fired by the hub (src/hub.js)
// for the changes made from the remote, the wall control or the app, never
// for this action: a scene bound to it would loop.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async boost(hub, { fields }) {
    const { until } = await hub.boost(fields.device, {
      speed: fields.speed,
      minutes: fields.minutes,
    });
    return { until: until.toISOString() };
  },
};
