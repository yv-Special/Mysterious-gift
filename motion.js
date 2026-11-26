/**
 * Springs for the cover hinge and the slide-to-centre layout, ported from
 * the project engine (src/lib/cardMotion.ts): semi-implicit Euler, the
 * hinge clamped to [0, π] with 20% restitution, tuned after bubbbly.
 */

export const HINGE_SPRING = { stiffness: 55, damping: 10 };
/** Over-damped hinge for prefers-reduced-motion: smooth, no overshoot. */
export const HINGE_SPRING_REDUCED = { stiffness: 55, damping: 26 };
export const LAYOUT_SPRING = { stiffness: 70, damping: 15 };
const HINGE_RESTITUTION = 0.2;

/** One semi-implicit Euler step towards `target`. Returns a new spring. */
export function stepSpring(s, target, p, dt) {
  const v = s.v + (p.stiffness * (target - s.x) - p.damping * s.v) * dt;
  return { x: s.x + v * dt, v };
}

/** Hinge step: spring, then keep the cover between shut (0) and π, bouncing softly. */
export function stepHinge(s, target, dt, params) {
  const p = params || HINGE_SPRING;
  const n = stepSpring(s, target, p, dt);
  if (n.x < 0) return { x: 0, v: HINGE_RESTITUTION * Math.abs(n.v) };
  if (n.x > Math.PI) return { x: Math.PI, v: -HINGE_RESTITUTION * Math.abs(n.v) };
  return n;
}

export const LAYOUT_BEND_AMP = 0.52; // peak bow angle at mid-turn (BOW_AMP)
