import type {ReactNode} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

// Docusaurus renders this around the whole app on every page without
// needing to swizzle the theme. We use it to mount a persistent top-right
// sign-in widget site-wide.
export default function Root({children}: {children: ReactNode}): ReactNode {
  return (
    <>
      <BrowserOnly>{() => {
        const AuthWidget = require('./AuthWidget').default;
        return <AuthWidget />;
      }}</BrowserOnly>
      {children}
    </>
  );
}
