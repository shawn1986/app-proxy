import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export type CertificateState = {
  caPath: string;
  exists: boolean;
  createdAt: string | null;
};

export type CaStorePaths = {
  caRootDir: string;
  certificateDir: string;
  keysDir: string;
  caPath: string;
  privateKeyPath: string;
  publicKeyPath: string;
};

export function resolveCaStorePaths(certificateDir: string): CaStorePaths {
  const resolvedCertificateDir = resolve(certificateDir);

  if (basename(resolvedCertificateDir) !== "certs") {
    throw new Error(`certificateDir must point to the 'certs' directory, got: ${resolvedCertificateDir}`);
  }

  const caRootDir = resolve(resolvedCertificateDir, "..");
  return {
    caRootDir,
    certificateDir: resolvedCertificateDir,
    keysDir: join(caRootDir, "keys"),
    caPath: join(resolvedCertificateDir, "ca.pem"),
    privateKeyPath: join(caRootDir, "keys", "ca.private.key"),
    publicKeyPath: join(caRootDir, "keys", "ca.public.key"),
  };
}

export function readCertificateState(certificateDir: string): CertificateState {
  const paths = resolveCaStorePaths(certificateDir);
  mkdirSync(paths.certificateDir, { recursive: true });
  mkdirSync(paths.keysDir, { recursive: true });

  if (
    !existsSync(paths.caPath) ||
    !existsSync(paths.privateKeyPath) ||
    !existsSync(paths.publicKeyPath)
  ) {
    return { caPath: paths.caPath, exists: false, createdAt: null };
  }

  return {
    caPath: paths.caPath,
    exists: true,
    createdAt: statSync(paths.caPath).mtime.toISOString(),
  };
}
