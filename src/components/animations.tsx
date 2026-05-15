"use client";

import { motion } from "framer-motion";
import { ReactNode, CSSProperties } from "react";
import { cn } from "@/lib/utils";

// Context provider for staggering multiple children gracefully
export function StaggerContainer({ children, className, style, delay = 0.1 }: { children: ReactNode; className?: string; style?: CSSProperties; delay?: number }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial="hidden"
      animate="visible"
      exit="hidden"
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: delay,
          },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

// A single smooth slide-up element used for Metric Cards and lists
export function SlideUp({ children, className, style, delay = 0 }: { children: ReactNode; className?: string; style?: CSSProperties; delay?: number }) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={{
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24, delay } }
      }}
    >
      {children}
    </motion.div>
  );
}

// A standard gentle fade in context
export function FadeIn({ children, className, style, delay = 0 }: { children: ReactNode; className?: string; style?: CSSProperties; delay?: number }) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, delay }}
    >
      {children}
    </motion.div>
  );
}

// Interactive scale wrapper for buttons and list items
export function HoverScale({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <motion.div
      className={cn("cursor-pointer", className)}
      style={style}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
    >
      {children}
    </motion.div>
  );
}
