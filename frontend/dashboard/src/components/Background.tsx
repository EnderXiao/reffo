export default function Background({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: "linear-gradient(135deg, #1a0b2e 0%, #0d0d1a 45%, #0a1628 100%)" }}>
      <div className="pointer-events-none absolute inset-0">
        <div className="animate-blob absolute -top-48 -left-48 h-[640px] w-[640px] rounded-full" style={{ background: "radial-gradient(circle, rgba(255,107,107,0.45), transparent 70%)" }} />
        <div className="animate-blob-reverse absolute top-1/4 -right-48 h-[720px] w-[720px] rounded-full" style={{ background: "radial-gradient(circle, rgba(107,159,255,0.4), transparent 70%)" }} />
        <div className="animate-blob absolute -bottom-32 left-1/4 h-[560px] w-[560px] rounded-full" style={{ background: "radial-gradient(circle, rgba(160,107,255,0.4), transparent 70%)" }} />
        <div className="absolute inset-0 opacity-[0.15]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
      </div>
      <div className="relative z-10">{children}</div>
      <style>{`
        @keyframes blob-float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(40px, -50px) scale(1.1); }
          66% { transform: translate(-30px, 30px) scale(0.92); }
        }
        .animate-blob { animation: blob-float 16s ease-in-out infinite; }
        .animate-blob-reverse { animation: blob-float 20s ease-in-out infinite reverse; }
      `}</style>
    </div>
  );
}
