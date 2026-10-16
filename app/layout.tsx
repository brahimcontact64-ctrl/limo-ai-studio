import './globals.css';import type {Metadata} from 'next';
export const metadata:Metadata={title:'LIMO AI Studio',description:'AI content operating system for social media teams'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
