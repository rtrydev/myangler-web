import Image from "next/image";

type LogoProps = {
  size?: number;
  className?: string;
};

export function Logo({ size = 32, className = "" }: LogoProps) {
  return (
    <Image
      src="/myangler-logo.webp"
      alt="Myangler"
      width={size}
      height={size}
      priority
      className={className}
      style={{
        width: size,
        height: size,
        filter: "drop-shadow(0 1px 2px rgba(36, 21, 9, 0.12))",
      }}
    />
  );
}

type WordmarkProps = {
  scale?: number;
};

export function Wordmark({ scale = 1 }: WordmarkProps) {
  return (
    <div className="inline-flex items-center" style={{ gap: 9 * scale }}>
      <Logo size={26 * scale} />
      <span
        className="serif text-ink"
        style={{ fontSize: 17 * scale, fontWeight: 500, letterSpacing: "0.005em" }}
      >
        Myangler
      </span>
    </div>
  );
}
