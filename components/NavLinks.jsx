import Link from "next/link";

const links = [
  { href: "/planner", label: "trip planner" },
  { href: "/planner/saved", label: "saved trips" },
  { href: "/tours", label: "tours" },
  { href: "/chat", label: "chat" },
  { href: "/vault", label: "knowledge vault" },
];

const NavLinks = () => {
  return (
    <ul className="menu text-base-content">
      {links.map((link) => {
        return (
          <li key={link.href}>
            <Link href={link.href} className="capitalize">
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
};
export default NavLinks;
