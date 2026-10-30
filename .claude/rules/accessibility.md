# Accessibility Rules

WCAG 2.2 AA is the default product baseline.

Prefer native semantic HTML over ARIA.
Accessibility is part of Definition of Done, not post-release remediation.
Automated checks (axe in Playwright) are necessary but insufficient; affected flows get a keyboard and screen-reader pass.
All video requires captions; meaningful audio requires equivalent text where applicable.
Playable items must be answerable without a mouse and without JavaScript where the existing no-JS answer path applies.
No pressure mechanics that depend on speed or motion; respect reduced-motion preferences.
