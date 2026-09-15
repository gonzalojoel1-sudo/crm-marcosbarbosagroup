export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 985 985"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Marcos Barbosa Group"
      style={{ borderRadius: 7, display: "block", flex: "none" }}
    >
      <rect width="985" height="985" fill="#FE6634" />
      <path
        fill="#FFFFFF"
        d="M168.2 274.2H281.3L332.2 534.7L384.7 274.2H497.7L519.8 725.7H424.8L414.6 428.5L365.4 725.7H304.1L245.1 428.5L238.4 725.7H143.8Z"
      />
      <path
        fill="#FFFFFF"
        fillRule="evenodd"
        d="M540.1 274.2H671.4C752.6 274.2 791.6 297.6 809.0 339.4C832.0 395.0 812.3 453.8 760.7 483.7C809.0 501.2 830.9 545.4 830.9 602.2C830.9 678.3 798.3 725.7 720.8 725.7H559.1ZM647.7 341.7V454.4H680.6C708.8 454.4 723.1 433.4 723.1 397.9C723.1 362.1 706.8 341.7 678.5 341.7ZM647.7 519.7V656.2H681.2C711.1 656.2 727.1 629.7 727.1 588.5C727.1 547.1 709.1 519.7 680.1 519.7Z"
      />
    </svg>
  );
}
