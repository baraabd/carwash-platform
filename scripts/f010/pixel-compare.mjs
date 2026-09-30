import assert from 'node:assert/strict';

export async function comparePngBuffers(browser, expected, actual, channelThreshold = 8) {
  assert.ok(Buffer.isBuffer(expected) && expected.length > 0, 'Expected PNG is required');
  assert.ok(Buffer.isBuffer(actual) && actual.length > 0, 'Actual PNG is required');
  assert.ok(
    Number.isSafeInteger(channelThreshold) && channelThreshold >= 0 && channelThreshold <= 255,
    'Invalid channel threshold',
  );
  const page = await browser.newPage({ viewport: { width: 16, height: 16 } });
  try {
    const result = await page.evaluate(
      async ({ expectedBase64, actualBase64, threshold }) => {
        const load = async (base64) => {
          const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
          return createImageBitmap(blob);
        };
        const [left, right] = await Promise.all([load(expectedBase64), load(actualBase64)]);
        if (left.width !== right.width || left.height !== right.height) {
          return {
            sameDimensions: false,
            width: left.width,
            height: left.height,
            actualWidth: right.width,
            actualHeight: right.height,
            changedPixels: null,
            diffRatio: 1,
            diffBase64: null,
          };
        }
        const canvas = document.createElement('canvas');
        canvas.width = left.width;
        canvas.height = left.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(left, 0, 0);
        const a = context.getImageData(0, 0, left.width, left.height);
        context.clearRect(0, 0, left.width, left.height);
        context.drawImage(right, 0, 0);
        const b = context.getImageData(0, 0, right.width, right.height);
        const diff = context.createImageData(left.width, left.height);
        let changedPixels = 0;
        for (let i = 0; i < a.data.length; i += 4) {
          const changed =
            Math.abs(a.data[i] - b.data[i]) > threshold ||
            Math.abs(a.data[i + 1] - b.data[i + 1]) > threshold ||
            Math.abs(a.data[i + 2] - b.data[i + 2]) > threshold ||
            Math.abs(a.data[i + 3] - b.data[i + 3]) > threshold;
          if (changed) {
            changedPixels += 1;
            diff.data.set([255, 0, 128, 255], i);
          } else {
            const gray = Math.round((a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3);
            diff.data.set([gray, gray, gray, 55], i);
          }
        }
        context.putImageData(diff, 0, 0);
        return {
          sameDimensions: true,
          width: left.width,
          height: left.height,
          actualWidth: right.width,
          actualHeight: right.height,
          changedPixels,
          diffRatio: changedPixels / (left.width * left.height),
          diffBase64: canvas.toDataURL('image/png').split(',')[1],
        };
      },
      {
        expectedBase64: expected.toString('base64'),
        actualBase64: actual.toString('base64'),
        threshold: channelThreshold,
      },
    );
    return {
      ...result,
      diffBuffer: result.diffBase64 ? Buffer.from(result.diffBase64, 'base64') : null,
    };
  } finally {
    await page.close();
  }
}
