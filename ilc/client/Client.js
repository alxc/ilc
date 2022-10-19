import * as singleSpa from 'single-spa';

import {
    PluginManager,
} from 'ilc-plugins-sdk/browser';

import UrlProcessor from '../common/UrlProcessor';
import { appIdToNameAndSlot } from '../common/utils';

import {
    setNavigationErrorHandler,
    addNavigationHook,
} from './navigationEvents/setupEvents';

import {
    CorsError,
    RuntimeError,
    InternalError,
    NavigationError,
    FragmentError,
    CriticalFragmentError,
    CriticalInternalError,
} from './errors';

import { triggerAppChange } from './navigationEvents';

import registryService from './registry/factory';

import Router from './ClientRouter';
import initIlcState from './initIlcState';
import setupPerformanceMonitoring from './performance';
import I18n from './i18n';

import GuardManager from './GuardManager';
import ParcelApi from './ParcelApi';
import { BundleLoader } from './BundleLoader';
import registerSpaApps from './registerSpaApps';
import { TransitionManager } from './TransitionManager/TransitionManager';
import IlcEvents from './constants/ilcEvents';
import ErrorHandlerManager from './ErrorHandlerManager/ErrorHandlerManager';

import { FRAGMENT_KIND } from '../common/constants';
import { SdkFactoryBuilder } from "./Sdk/SdkFactoryBuilder";

export class Client {

    #configRoot;

    #moduleLoader;

    #logger;

    #registryService;

    #errorHandlerManager;

    #transitionManager;

    #pluginManager;

    #i18n;

    #router;

    #guardManager;

    #urlProcessor;

    #bundleLoader;

    #sdkFactoryBuilder;

    constructor(config) {
        this.#configRoot = config;

        // TODO: Move to separate module/abstraction
        this.#logger = window.console;
        this.#registryService = registryService;

        this.#errorHandlerManager = new ErrorHandlerManager(this.#logger, this.#registryService);

        this.#transitionManager = new TransitionManager(this.#logger, this.#configRoot.getSettingsByKey('globalSpinner'));
        this.#pluginManager = new PluginManager(require.context('../node_modules', true, /ilc-plugin-[^/]+\/browser\.js$/));

        const i18nSettings = this.#configRoot.getSettingsByKey('i18n');

        if (i18nSettings.enabled) {
            this.#i18n = new I18n(i18nSettings, {
                    ...singleSpa,
                    triggerAppChange,
                },
                this.#errorHandlerFor.bind(this),
                this.#transitionManager
            );
        }

        const ilcState = initIlcState();
        this.#router = new Router(this.#configRoot, ilcState, this.#i18n, singleSpa, this.#transitionManager.handlePageTransition.bind(this.#transitionManager));
        this.#guardManager = new GuardManager(this.#router, this.#pluginManager, this.#onCriticalInternalError.bind(this));
        this.#urlProcessor = new UrlProcessor(this.#configRoot.getSettingsByKey('trailingSlash'));

        this.#moduleLoader = this.#getModuleLoader();
        this.#sdkFactoryBuilder = new SdkFactoryBuilder(this.#configRoot, this.#i18n, this.#router);
        this.#bundleLoader = new BundleLoader(this.#configRoot, this.#moduleLoader, this.#sdkFactoryBuilder);

        this.#preheat();
        this.#expose();
        this.#configure();
    }

    #preheat() {
        // Initializing 500 error page to cache template of this page
        // to avoid a situation when localhost can't return this template in future
        this.#registryService.preheat()
            .then(() => this.#logger.log('ILC: Registry service preheated successfully'))
            .catch((error) => {
                const preheatError = new InternalError({
                    cause: error,
                    message: 'Failed to preheat registry service', 
                });

                this.#errorHandlerManager.handleError(preheatError);
            });
    }

    #getModuleLoader() {
        if (window.System === undefined) {
            const error = new Error('ILC: can\'t find SystemJS on a page, crashing everything');
            this.#onCriticalInternalError(error);

            throw error;
        }

        return window.System;
    }

    #errorHandlerFor(appName, slotName) {
        if (!navigator.onLine) {
            return window.location.reload();
        }

        return (error, errorInfo) => {
            const fragmentKind = this.#router.getRelevantAppKind(appName, slotName);

            const isCriticalError = [
                FRAGMENT_KIND.primary,
                FRAGMENT_KIND.essential
            ].includes(fragmentKind);

            const errorParams = {
                cause: error,
                data: {
                    ...errorInfo,
                    appName,
                    slotName,
                }
            };

            const fragmentError = isCriticalError ? new CriticalFragmentError(errorParams) : new FragmentError(errorParams);
            this.#errorHandlerManager.handleError(fragmentError);
        };
    }

    #onNavigationError(error, errorInfo) {
        const navigationError = new NavigationError({
            data: errorInfo,
            cause: error,
        });

        this.#errorHandlerManager.handleError(navigationError);
    }

    #onCriticalInternalError(error, errorInfo) {
        const criticalError = new CriticalInternalError({
            data: errorInfo,
            cause: error,
        });

        this.#errorHandlerManager.handleError(criticalError);
    }

    #isCorsError(event) {
        const { error, colno, lineno } = event;

        return (!error && lineno === 0 && colno === 0);
    }

    #onRuntimeError(event) {
        let { error } = event;

        if (this.#isCorsError(event)) {
            error = new CorsError({
                message: event.message
            });
        } else {
            event.preventDefault();
        }

        const { filename: fileName } = event;
        let moduleInfo = this.#moduleLoader.getModuleInfo(fileName);

        if (moduleInfo === null) {
            moduleInfo = {
                name: 'UNKNOWN_MODULE',
                dependants: [],
            };
        }

        const runtimeError = new RuntimeError({
            cause: error,
            data: {
                ...moduleInfo,
                location: {
                    fileName,
                    colNo: event.colno,
                    lineNo: event.lineno,
                },
            },
        });

        this.#errorHandlerManager.handleError(runtimeError);
    }

    #onLifecycleError(error) {
        const { appName, slotName } = appIdToNameAndSlot(error.appOrParcelName);
        this.#transitionManager.reportSlotRenderingError(slotName);

        this.#errorHandlerFor(appName, slotName)(error);
    }

    #configure() {
        addNavigationHook((url) => this.#guardManager.hasAccessTo(url) ? url : null);
        addNavigationHook((url) => this.#urlProcessor.process(url));

        // TODO: window.ILC.importLibrary - calls bootstrap function with props (if supported), and returns exposed API
        // TODO: window.ILC.importParcelFromLibrary - same as importParcelFromApp, but for libs
        registerSpaApps(
            this.#configRoot,
            this.#router,
            this.#errorHandlerFor.bind(this),
            this.#bundleLoader,
            this.#transitionManager,
            this.#sdkFactoryBuilder
        );

        setNavigationErrorHandler(this.#onNavigationError.bind(this));
        window.addEventListener('error', this.#onRuntimeError.bind(this));

        setupPerformanceMonitoring(this.#router.getCurrentRoute);

        singleSpa.addErrorHandler(this.#onLifecycleError.bind(this));
        singleSpa.setBootstrapMaxTime(5000, false);
        singleSpa.setMountMaxTime(5000, false);
        singleSpa.setUnmountMaxTime(3000, false);
        singleSpa.setUnloadMaxTime(3000, false);
    }

    #addIntlChangeHandler(handler) {
        if (typeof handler !== 'function') {
            throw new Error('onIntlChange should pass function handler as first argument');
        }

        window.addEventListener(IlcEvents.INTL_UPDATE, (event) => {
            const intlValues = {
                locale: event.detail.locale,
                currency: event.detail.currency,
            };

            handler(intlValues);
        });
    }

    #expose() {
        // Here we expose window.ILC.define also as window.define to ensure that regular AMD/UMD bundles work correctly by default
        // See docs/umd_bundles_compatibility.md
        if (!this.#configRoot.getConfig().settings.amdDefineCompatibilityMode) {
            window.define = window.ILC.define;
        }

        const parcelApi = new ParcelApi(
            this.#configRoot.getConfig(),
            this.#bundleLoader,
            this.#sdkFactoryBuilder.getSdkAdapterInstance.bind(this.#sdkFactoryBuilder)
        );

        Object.assign(window.ILC, {
            loadApp: this.#bundleLoader.loadAppWithCss.bind(this.#bundleLoader), // Internal API for Namecheap, not for public use
            navigate: this.#router.navigateToUrl.bind(this.#router),
            onIntlChange: this.#addIntlChangeHandler.bind(this),
            mountRootParcel: singleSpa.mountRootParcel.bind(singleSpa),
            importParcelFromApp: parcelApi.importParcelFromApp.bind(this),
            getAllSharedLibNames: () => Promise.resolve(Object.keys(this.#configRoot.getConfig().sharedLibs)),
            getSharedLibConfigByName: (name) => {
                return Promise.resolve(this.#configRoot.getConfigForSharedLibsByName(name));
            },
            // @Deprecated
            // This method was designed to allow to create an app w/o singleSPA invocation (Case for dynamically loaded application)
            // It leads to situation when fragment creates dependency to ilc-sdk
            // Ilc has ilc-sdk dependency as well
            // So we are not protected from deps version mismatch :(
            // To solve it we created SdkFactoryBuilder that allow to create AppSdk instances and passing it to the app
            // So global 'getAppSdkAdapter' has no sence any more. We will remove it in next major release.
            getAppSdkAdapter: this.#sdkFactoryBuilder.getSdkAdapterInstance.bind(this.#sdkFactoryBuilder),
        });
    }

    start() {
        singleSpa.start({ urlRerouteOnly: true });
    }
}