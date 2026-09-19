import { HiAcademicCap, HiBookOpen, HiBuildingOffice2, HiLifebuoy, HiMagnifyingGlassCircle, HiPhone, HiPrinter, HiShoppingCart, HiWrenchScrewdriver } from "react-icons/hi2";

const canteens = [
  {
    id: 1,
    name: "Udupi",
    subtitle: "South Indian",
    status: "Quiet",
    eta: "8–12 min",
    load: 32,
    color: "green",
  },
  {
    id: 2,
    name: "Tango",
    subtitle: "Rolls · Noodles · Biryani · Pasta",
    status: "Moderate",
    eta: "12–18 min",
    load: 58,
    color: "moderate",
  },
  {
    id: 3,
    name: "Munch",
    subtitle: "Fried Rice · Noodles · Chinese",
    status: "Busy",
    eta: "20–28 min",
    load: 84,
    color: "busy",
  },
  {
    id: 4,
    name: "Nescafe",
    subtitle: "Coffee · Maggi · Snacks",
    status: "Quiet",
    eta: "6–10 min",
    load: 26,
    color: "green",
  },
];

const services = [
  {
    icon: <HiPrinter />,
    title: "Print & Documents",
    text: "Upload, print, bind and collect with QR pickup",
    action: "Open",
    id: "print",
  },
  {
    icon: <HiBookOpen />,
    title: "Campus Store",
    text: "Stationery, records, books and academic supplies",
    action: "Browse",
    id: "store",
  },
  {
    icon: <HiWrenchScrewdriver />,
    title: "Report an Issue",
    text: "Wi-Fi, electrical, AC, furniture and equipment",
    action: "Report",
    id: "issues",
  },
  {
    icon: <HiBuildingOffice2 />,
    title: "Resource Booking",
    text: "Book halls, labs, equipment and sports facilities",
    action: "Book",
    id: "booking",
  },
  {
    icon: <HiMagnifyingGlassCircle />,
    title: "Lost & Found",
    text: "Report or find lost items around campus",
    action: "Open",
    id: "lost",
  },
  {
    icon: <HiShoppingCart />,
    title: "Campus Marketplace",
    text: "Buy and sell permitted items within campus",
    action: "Browse",
    id: "market",
  },
  {
    icon: <HiAcademicCap />,
    title: "Academics",
    text: "Department/faculty announcements, assignments, timetable and academic calendar",
    action: "Open",
    id: "academics",
  },
  {
    icon: <HiPhone />,
    title: "Emergency Directory",
    text: "Verified security, medical, hostel and transport contacts",
    action: "View",
    id: "emergencydirectory",
  },
  {
    icon: <HiLifebuoy />,
    title: "Support",
    text: "Account, payment or technical problems — talk to campus staff",
    action: "Get help",
    id: "support",
  },
];

export { canteens, services };
