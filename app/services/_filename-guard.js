// Validator for FILE_* env values used in app/companies/<portal>/<fileName>.<ext>
// path construction. Without this, FILE_GH=../../etc/passwd happily reads
// outside the intended directory. Operator-controlled today, but defence in
// depth is cheap.

const SAFE_FILE_NAME = /^[a-z0-9_-]+$/i;

export const ensureSafeFileName = (name) => {
    if (!name || !SAFE_FILE_NAME.test(name)) {
        throw new Error(`Unsafe FILE_* value rejected by validator: ${JSON.stringify(name)}`);
    }
    return name;
};
