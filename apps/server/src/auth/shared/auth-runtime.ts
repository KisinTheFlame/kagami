type OAuthRuntimeBundle<TCallbackServer, TService> = {
  callbackServer: TCallbackServer;
  service: TService;
};

type CreateOAuthRuntimeBundleInput<TCallbackServer, TService> = {
  callbackServer: TCallbackServer;
  createService: (callbackServer: TCallbackServer) => TService;
  bindService: (callbackServer: TCallbackServer, service: TService) => void;
};

export function createOAuthRuntimeBundle<TCallbackServer, TService>({
  callbackServer,
  createService,
  bindService,
}: CreateOAuthRuntimeBundleInput<TCallbackServer, TService>): OAuthRuntimeBundle<
  TCallbackServer,
  TService
> {
  const service = createService(callbackServer);
  bindService(callbackServer, service);

  return {
    callbackServer,
    service,
  };
}
