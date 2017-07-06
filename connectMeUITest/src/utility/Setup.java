package utility;

import io.appium.java_client.AppiumDriver;
import io.appium.java_client.ios.IOSDriver;
import org.openqa.selenium.remote.DesiredCapabilities;
import org.openqa.selenium.remote.RemoteWebDriver;

import java.net.URL;
import java.util.concurrent.TimeUnit;

/**
 * Created by ankurmishra on 6/22/17.
 */

public class Setup {

	public static AppiumDriver driver = null;

	public static AppiumDriver openApp(String Device) throws Exception {

		String sBrowserName;

		try {

			DesiredCapabilities capabilities = new DesiredCapabilities();

			if (Device == "Real Device") {
				capabilities.setCapability("automationName", "XCUITest");
				capabilities.setCapability("platformVersion", "10.0");
				capabilities.setCapability("platformName", "iOS");
				capabilities.setCapability("bundleId", "com.evernym.connectme.callcenter");
				capabilities.setCapability("deviceName", "Ankur's iPhone");//device name
				capabilities.setCapability("udid", "42d9657d87b56203d1c4c5eb22fde827ca2c0090");//udid of device
                capabilities.setCapability("app","Users/khagesh/Downloads/ConnectMe-4.ipa");//ipa path
				// capabilities.setCapability("udid",
				// "b78a49129d22c79c81e303b812d14abaa6fc817d");
				capabilities.setCapability("xcodeOrgId", "ES8QU3D2A4");
				capabilities.setCapability("xcodeSigningId", "iPhone Developer");
				driver = new IOSDriver(new URL("http://183.82.106.249:4723/wd/hub"), capabilities);
			/*
			 * We initialize the Appium driver that will connect us to the ios
			 * device with the capabilities that we have just set. The URL we
			 * are providing is telling Appium we
			 * http://183.82.106.249:4723/wd/hub
			 * 
			 * are going to run the test on Real ios Device lets say iphone 6s.
			 */

			driver.manage().timeouts().implicitlyWait(60, TimeUnit.SECONDS);
			// Setting DefauLt time out to 60 seconds
			Log.info("Mobile application launched successfully");

		}
			}

		catch (Exception e)

		{

			Log.error("Class Setup | Method OpenBrowser | Exception desc : " + e.getMessage());

		}

		return driver;

	}

}
