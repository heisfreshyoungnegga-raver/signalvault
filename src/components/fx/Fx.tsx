import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * 3D tilt on pointer — physics via GSAP quickTo, off for touch + reduced motion.
 * Kept for compatibility; cards no longer use it (flat lift + terracotta ring
 * on hover instead — see dw-card-3d in styles.css).
 */
export function Tilt({ children, className, max = 9 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add("(pointer: fine) and (prefers-reduced-motion: no-preference)", () => {
      const rX = gsap.quickTo(el, "rotationX", { duration: 0.7, ease: "power3.out" });
      const rY = gsap.quickTo(el, "rotationY", { duration: 0.7, ease: "power3.out" });
      gsap.set(el, { transformPerspective: 1200, transformStyle: "preserve-3d" });
      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        rY(gsap.utils.mapRange(0, r.width, -max, max, e.clientX - r.left));
        rX(gsap.utils.mapRange(0, r.height, max, -max, e.clientY - r.top));
      };
      const leave = () => { rX(0); rY(0); };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
      return () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); };
    });
    return () => mm.revert();
  }, [max]);
  return <div ref={ref} className={className}>{children}</div>;
}

/** Scroll reveal — content rises + fades as it enters, staggered by data-delay. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(el, { autoAlpha: 0, y: 34 }, {
        autoAlpha: 1, y: 0, duration: 0.9, delay, ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
      });
    });
    return () => mm.revert();
  }, [delay]);
  return <div ref={ref} className={className}>{children}</div>;
}

// Matrix rain is deleted: the falling green characters were a SignalVault
// tell and have no place on a cream paper site. Nothing imports it
// anymore — do not re-add it.
