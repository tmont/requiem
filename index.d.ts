/// <reference types="node" />
import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';
interface BaseRequiemOptions extends tls.SecureContextOptions, Pick<https.RequestOptions, 'rejectUnauthorized' | 'servername'>, Pick<http.RequestOptions, 'headers' | 'timeout' | 'auth' | 'agent'> {
    method?: string;
    followRedirects?: number;
    throwOnErrorResponse?: boolean | number;
}
interface WithBody {
    body?: string | Buffer;
}
interface WithBodyJson {
    bodyJson?: any;
}
interface HostOptions {
    host: string;
    path?: string;
    pathname?: string;
    port?: number;
    protocol?: string;
}
interface UrlOptions {
    url: string;
}
export interface RequiemUrlOptions extends BaseRequiemOptions, UrlOptions, Partial<Record<keyof HostOptions, undefined>> {
}
export interface RequiemHostOptions extends BaseRequiemOptions, HostOptions, Partial<Record<keyof UrlOptions, undefined>> {
}
export interface RequiemUrlWithBodyOptions extends RequiemUrlOptions, WithBody, Partial<Record<keyof WithBodyJson, undefined>> {
}
export interface RequiemUrlWithJsonOptions extends RequiemUrlOptions, WithBodyJson, Partial<Record<keyof WithBody, undefined>> {
}
export interface RequiemHostWithBodyOptions extends RequiemHostOptions, WithBody, Partial<Record<keyof WithBodyJson, undefined>> {
}
export interface RequiemHostWithJsonOptions extends RequiemHostOptions, WithBodyJson, Partial<Record<keyof WithBody, undefined>> {
}
declare type RequiemOptionsObject = RequiemUrlWithBodyOptions | RequiemUrlWithJsonOptions | RequiemHostWithBodyOptions | RequiemHostWithJsonOptions;
export declare type RequiemOptions = string | RequiemOptionsObject;
export interface RequiemResponse extends http.IncomingMessage {
    requestedUrl: string;
}
export interface RequiemResponseWithBody<T> extends RequiemResponse {
    body: T;
}
export interface RequiemRequest extends http.ClientRequest {
    requestedUrl: string;
}
export declare type RequiemErrorCode = 'Timeout' | 'RequestAbort' | 'TooManyRedirects' | 'InvalidUrl' | 'InvalidStatusCode' | 'InvalidJsonBody' | 'InvalidRedirectUrl';
export declare class RequiemError extends Error {
    readonly req: RequiemRequest | null;
    readonly res: RequiemResponse | null;
    readonly code: RequiemErrorCode;
    constructor(code: RequiemErrorCode, message: string, req?: RequiemRequest | null, res?: RequiemResponse | null);
}
export declare const createRequest: (options: RequiemOptions) => RequiemRequest;
export declare const sendRequest: (req: RequiemRequest, options: RequiemOptions) => Promise<RequiemResponse>;
export declare const request: (options: RequiemOptions) => Promise<RequiemResponse>;
export declare const requestBody: (options: RequiemOptions) => Promise<RequiemResponseWithBody<Buffer>>;
export declare const requestJson: <T = any>(options: RequiemOptions) => Promise<RequiemResponseWithBody<T>>;
export {};
