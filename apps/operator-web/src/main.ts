/**
 * operator-web browser entry: the production port of the approved technician
 * reference. The three stylesheets are the reference <style> block, byte for
 * byte, split at the reference's own comment boundaries (verified by
 * tests/production/C/operator-web-visual.test.mjs).
 */
import './styles/01-reference-base.css';
import './styles/02-reference-sheets-motion.css';
import './styles/03-reference-compact.css';
import { applyInlineStyles } from './dom';
import { start } from './app';

applyInlineStyles(document.body);
start();
