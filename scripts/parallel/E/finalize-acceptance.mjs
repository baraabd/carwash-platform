/** Persist acceptance only after cleanup has contributed its actual result. */
export async function finalizeAcceptance({
  report,
  context,
  provisioned,
  keep,
  cleanup,
  finish,
  detail,
  redact,
}) {
  if (provisioned && keep) {
    report.record('infra: teardown', 'SKIPPED', {
      note: 'Owned stack retained by --keep; this is not acceptance.',
    });
  } else if (provisioned) {
    try {
      const result = await cleanup(context);
      if (result.code !== 0) {
        report.record('infra: teardown', 'FAIL', {
          note: 'Owned stack teardown failed',
          stderr: redact(result.stderr ?? ''),
        });
      } else {
        report.record('infra: teardown', 'PASS', { note: `project ${context.project} removed` });
      }
    } catch (error) {
      report.record('infra: teardown', 'FAIL', { note: redact(error.message) });
    }
  }
  return finish(report, context, detail);
}
