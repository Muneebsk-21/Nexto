import { ClerkProvider } from "@clerk/nextjs";

export default function Layout({ children }) {
  return (
    <ClerkProvider>
      <div className="container mx-auto mt-24 mb-20">
        {children}
      </div>
    </ClerkProvider>
  );
}
