"use client";
import { useEffect, useRef, useState } from "react";

export default function FadeInSection({
 children,
 className = "",
 delay = 0,
}: {
 children: React.ReactNode;
 className?: string;
 delay?: number;
}) {
 const ref = useRef<HTMLDivElement>(null);
 const [visible, setVisible] = useState(false);

 useEffect(() => {
    // Small delay to ensure DOM is ready after hydration
 const timer = setTimeout(() => {
 const observer = new IntersectionObserver(
        ([entry]) => {
 if (entry.isIntersecting) {
 setTimeout(() => setVisible(true), delay);
 observer.disconnect();
          }
        },
        { threshold: 0.05, rootMargin: "50px" }
      );
 if (ref.current) {
        // If already in view, trigger immediately
 const rect = ref.current.getBoundingClientRect();
 if (rect.top < window.innerHeight && rect.bottom > 0) {
 setTimeout(() => setVisible(true), delay);
        } else {
 observer.observe(ref.current);
        }
      }
 return () => observer.disconnect();
    }, 50);
 return () => clearTimeout(timer);
  }, [delay]);

 return (
    <div
 ref={ref}
 className={`transition-all duration-700 ease-out ${
 visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}
